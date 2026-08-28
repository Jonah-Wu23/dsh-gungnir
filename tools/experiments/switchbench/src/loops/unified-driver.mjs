/**
 * unified-driver.mjs — SwitchBench 的最小统一 agent-loop 契约宿主（实验 §3 冻结件）。
 *
 * 这是 UnifiedDriver 基座：代理未来的 Adaptive Meta-Loop 的"物理规律"，同时是
 * B 组的接班 loop（ExecutionLoop 与 UnifiedDriver 是同一份代码，EXPERIMENT.md §3）。
 * 基座物理规律（对两架构一致，冻结）：
 *   1. 单一主上下文（message 数组）；没有上下文删除/压缩；没有多上下文。
 *   2. turn = 一次模型请求 → 其全部 tool calls → 全部 tool results；未完则下一 turn。
 *   3. 一次响应内的多个 tool calls 经调度器并行执行（Promise.all）。
 *   4. 工具结果一律 append 进唯一上下文。
 *   5. 结束条件：finish 工具 / 无 tool calls 的纯文本响应 / turn 上限 / deadline。
 *
 * 基座不含任何 strategy 概念。A 组的 strategy-host（sub-conversation、driveTurn
 * 钩子、工具过滤）是独立模块，只为 A 存在——这正是"Architecture 指标：A 的强行
 * 适配成本"的计量对象。B 组裸用本模块，零扩展。
 */
import { toolSchemas } from './workspace-tools.mjs'

export const DRIVER_CAPS = {
  maxTurns: 40,
  requestMaxTokens: 8192,
}

export class UnifiedDriver {
  /**
   * @param {object} opts
   * @param {import('./model-client.mjs').ModelClient} opts.model 共享模型客户端（usage 归 run 总账）
   * @param {import('./workspace-tools.mjs').WorkspaceTools} opts.tools 共享工具执行器
   * @param {Array<object>} opts.context 初始主上下文（message 数组，调用方持有引用）
   * @param {(event: object) => void} [opts.onEvent]
   * @param {number} [opts.maxTurns]
   * @param {number} [opts.deadlineMs] 相对 driver 创建时刻的总时限；超时抛 DriverTimeout
   * @param {string} [opts.label] 事件与日志里的 driver 标识（如 'main' / 'branch-h1'）
   * @param {number} [opts.seed] 透传给 API 的采样种子（仅记录，不承诺确定性）
   * @param {Array<object>} [opts.advertiseTools] 向模型声明的工具 schema；
   *   缺省全量。基座原本不需要此参数——它只为 A 的 strategy sub-conversation
   *   （限定调查工具面）而存在，计入 A 的强行适配成本（[deformation] 登记）。
   */
  constructor({ model, tools, context, onEvent, maxTurns = DRIVER_CAPS.maxTurns, deadlineMs, label = 'main', seed, advertiseTools }) {
    this.model = model
    this.tools = tools
    this.context = context
    this.onEvent = onEvent ?? (() => {})
    this.maxTurns = maxTurns
    this.deadlineAt = deadlineMs === undefined ? null : Date.now() + deadlineMs
    this.label = label
    this.seed = seed
    this.advertiseTools = advertiseTools ?? null
    this.turns = 0
    this.finished = false
    this.finishReason = null
    this.finishSummary = null
  }

  event(event) {
    this.onEvent({ driver: this.label, ...event })
  }

  remainingMs() {
    return this.deadlineAt === null ? Number.POSITIVE_INFINITY : this.deadlineAt - Date.now()
  }

  checkDeadline(what) {
    if (this.remainingMs() <= 0) {
      const error = new Error(`deadline exceeded while ${what}`)
      error.driverTimeout = true
      throw error
    }
  }

  /**
   * 一个标准 turn：一次模型请求 + 其 tool calls 的并行执行 + 结果入上下文。
   * @returns {Promise<boolean>} 是否发生了 tool calls
   */
  async step() {
    this.turns += 1
    this.checkDeadline('starting a model request')
    this.event({ type: 'turn-start', turn: this.turns, contextMessages: this.context.length })
    const response = await this.model.chat({
      messages: this.context,
      tools: this.advertiseTools ?? toolSchemas(),
      maxTokens: DRIVER_CAPS.requestMaxTokens,
      seed: this.seed,
      timeoutMs: Math.min(180_000, Math.max(30_000, this.remainingMs())),
    })
    const message = response.message
    this.context.push(normalizeAssistantMessage(message))
    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length === 0) {
      this.event({ type: 'turn-end', turn: this.turns, toolCalls: 0 })
      // 无 tool calls 的纯文本响应：driver 认为模型已停止动作（结束条件之一）。
      this.finished = true
      this.finishReason = 'no-tool-calls'
      this.finishSummary = typeof message.content === 'string' ? message.content : ''
      return false
    }
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        let args = {}
        try {
          args = call.function?.arguments === undefined ? {} : JSON.parse(call.function.arguments)
        } catch {
          args = { __raw: call.function?.arguments }
        }
        const outcome = await this.tools.execute(call.function?.name ?? 'unknown', args)
        return { call, outcome }
      }),
    )
    for (const { call, outcome } of results) {
      this.context.push({
        role: 'tool',
        tool_call_id: call.id,
        content: outcome.output,
      })
      if (call.function?.name === 'finish' && outcome.ok) {
        this.finished = true
        this.finishReason = 'finish-tool'
        this.finishSummary = outcome.finishSummary ?? ''
      }
    }
    this.event({ type: 'turn-end', turn: this.turns, toolCalls: toolCalls.length })
    return true
  }

  /** 跑到结束条件为止（基座物理规律内的标准主循环）。 */
  async run() {
    this.event({ type: 'driver-run-start', label: this.label })
    while (!this.finished) {
      if (this.turns >= this.maxTurns) {
        this.finished = true
        this.finishReason = 'max-turns'
        this.event({ type: 'driver-limit', limit: 'max-turns', turns: this.maxTurns })
        break
      }
      this.checkDeadline('running the next turn')
      await this.step()
    }
    this.event({ type: 'driver-run-end', label: this.label, finishReason: this.finishReason, turns: this.turns })
    return { finishReason: this.finishReason, finishSummary: this.finishSummary, turns: this.turns }
  }
}

/**
 * 归一 assistant 消息进上下文：content 为空时置 null（openai-completions 线格式
 * 兼容），不回传 reasoning_content（协议不属于上下文真理；工具调用清单保留）。
 */
function normalizeAssistantMessage(message) {
  const content = typeof message.content === 'string' && message.content.trim() === '' ? null : (message.content ?? null)
  return {
    role: 'assistant',
    content,
    ...(message.tool_calls !== undefined && message.tool_calls.length > 0 ? { tool_calls: message.tool_calls } : {}),
  }
}
