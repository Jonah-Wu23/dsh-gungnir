/**
 * branch-search-loop.mjs — 方案 B：Branch Search 作为自持 loop（EXPERIMENT.md §3）。
 *
 * 与 A 的本质差别：本 loop 不住进任何统一契约——frontier、分支状态、并发、收敛
 * 全部自持；调查语义与 A 共用 branch-protocol.mjs（公平性），但承载它的循环是
 * 独立实现（这正是"Loop ≈ Runtime Resource"的主张：控制器本体是可替换的实现）。
 *
 * 生命周期：ENUMERATE（自持会话，只留假设清单）→ INVESTIGATE（并行分支会话，
 * 独立上下文与报告）→ CONVERGE（确定性规则，与 A 同一字节级实现）→ **SafePoint**
 * （无 open request / open tool call；构造并校验 8 字段 HandoffPacket）→ 返回。
 * 之后 ExecutionLoop（= UnifiedDriver 基座，另一份实例）接班——交接面只有包。
 */
import { WorkspaceTools, toolSchemas } from './workspace-tools.mjs'
import { DRIVER_CAPS } from './unified-driver.mjs'
import {
  BRANCH_CAPS,
  BRANCH_TOOLSET,
  ENUMERATION_PROMPT,
  ENUMERATION_REQUEST,
  REPORT_REQUEST,
  TASK_BRIEF,
  investigationSystemPrompt,
  parseReport,
  selectHypothesis,
} from './branch-protocol.mjs'
import { buildHandoffPacket } from './handoff-packet.mjs'

const GOAL_CONSTRAINTS = ['only-src', 'no-new-deps', 'api-stable', 'stay-in-workspace']

export class BranchSearchLoop {
  /**
   * @param {object} opts
   * @param {import('./model-client.mjs').ModelClient} opts.model
   * @param {import('./workspace-tools.mjs').WorkspaceTools} opts.tools 主工具执行器（观察态源头）
   * @param {(event: object) => void} [opts.onEvent]
   * @param {number} [opts.deadlineMs]
   * @param {number} [opts.seed]
   */
  constructor({ model, tools, onEvent, deadlineMs, seed }) {
    this.model = model
    this.tools = tools
    this.onEvent = onEvent ?? (() => {})
    this.deadlineAt = deadlineMs === undefined ? null : Date.now() + deadlineMs
    this.seed = seed
    this.phase = 'idle'
    this.phases = []
    this.inFlight = 0 // SafePoint 前提的可观测计数
  }

  event(event) {
    this.onEvent(event)
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
   * 跑到 SafePoint 为止。
   * @returns {Promise<{packet: object, telemetry: object}>}
   */
  async run() {
    const started = Date.now()
    this.event({ type: 'loop-run-start', loop: 'branch-search' })
    const hypotheses = await this.enumerate()
    const reports = await this.investigate(hypotheses)
    const { selected, reason } = selectHypothesis(hypotheses, reports.map((entry) => entry.report))
    this.event({ type: 'loop-converged', selected: selected?.hypothesis_id ?? null, reason })

    // ---- SafePoint：所有会话已收口（inFlight == 0），构造并校验薄交接包 ----
    this.checkDeadline('building the handoff packet')
    if (this.inFlight !== 0) throw new Error('SafePoint violated: requests or tool calls still in flight')
    const packet = buildHandoffPacket(this.composePacket(hypotheses, reports, selected, reason))
    const packetBytes = Buffer.byteLength(JSON.stringify(packet), 'utf8')
    this.event({ type: 'safepoint-handoff', packetBytes, selected: selected?.hypothesis_id ?? null })
    this.phases.push({ phase: 'converge+handoff', ms: Date.now() - started, selected: selected?.hypothesis_id ?? null, packetBytes })
    return { packet, telemetry: { phases: this.phases, packetBytes, totalMs: Date.now() - started, selectionReason: reason } }
  }

  /** ENUMERATE：自持会话枚举假设；上下文在收口后丢弃（只有假设清单越过阶段边界）。 */
  async enumerate() {
    const started = Date.now()
    this.phase = 'enumerate'
    this.event({ type: 'loop-phase', phase: 'enumerate' })
    const conversation = this.newConversation('enumerate', [
      { role: 'system', content: ENUMERATION_PROMPT },
      { role: 'user', content: TASK_BRIEF },
    ], 8)
    let enumeration = null
    let rawTail = ''
    try {
      let text = await this.driveConversation(conversation, new Set(BRANCH_TOOLSET))
      enumeration = parseReport(text)
      if (enumeration === null) {
        // 调查轮次用尽但未产出 JSON：补一次收口请求（与 A 组同一协议）。
        conversation.context.push({ role: 'user', content: ENUMERATION_REQUEST })
        conversation.maxTurns = conversation.turns + 1
        text = await this.driveConversation(conversation, new Set(BRANCH_TOOLSET))
        enumeration = parseReport(text)
      }
    } catch (error) {
      if (error.driverTimeout === true) throw error
      this.event({ type: 'loop-error', phase: 'enumerate', error: String(error?.message ?? error) })
    }
    rawTail = conversation.lastText?.slice(-600) ?? ''
    const hypotheses = cleanHypotheses(enumeration?.hypotheses).slice(0, BRANCH_CAPS.maxHypotheses)
    if (hypotheses.length === 0) {
      this.event({ type: 'loop-degrade', phase: 'enumerate', reason: 'hypothesis enumeration unparseable', rawTail })
      this.phases.push({ phase: 'enumerate', ms: Date.now() - started, hypotheses: 0, degraded: true })
      return []
    }
    this.phases.push({ phase: 'enumerate', ms: Date.now() - started, hypotheses: hypotheses.length })
    this.event({ type: 'loop-hypotheses', hypotheses })
    return hypotheses
  }

  /** INVESTIGATE：并行分支会话（与 A 相同的并发上限与报告协议）。 */
  async investigate(hypotheses) {
    const started = Date.now()
    this.phase = 'investigate'
    this.event({ type: 'loop-phase', phase: 'investigate', branches: hypotheses.length })
    if (hypotheses.length === 0) return []
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(BRANCH_CAPS.branchConcurrency, hypotheses.length) }, async () => {
      const results = []
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= hypotheses.length) return results
        results.push(await this.investigateOne(hypotheses[index]))
      }
    })
    const settled = (await Promise.all(workers)).flat()
    const parsed = settled.filter((entry) => entry.report !== null).map((entry) => entry.report)
    this.event({ type: 'loop-reports', reports: parsed, unparseable: settled.length - parsed.length })
    this.phases.push({ phase: 'investigate', ms: Date.now() - started, branches: hypotheses.length, reportsParsed: parsed.length })
    return settled
  }

  async investigateOne(hypothesis) {
    const label = `branch-${hypothesis.id}`
    const conversation = this.newConversation(label, [
      { role: 'system', content: investigationSystemPrompt(hypothesis) },
      { role: 'user', content: TASK_BRIEF },
    ], BRANCH_CAPS.maxBranchRequests)
    this.inFlight += 1
    try {
      this.checkDeadline('starting an investigation branch')
      let text = await this.driveConversation(conversation, new Set(BRANCH_TOOLSET))
      let report = parseReport(text)
      if (report === null) {
        // 报告缺失：补一次只要求 JSON 的收尾请求（与 A 组同一协议）。
        conversation.context.push({ role: 'user', content: REPORT_REQUEST })
        conversation.maxTurns = conversation.turns + 1
        text = await this.driveConversation(conversation, new Set(BRANCH_TOOLSET))
        report = parseReport(text)
      }
      return { hypothesis_id: hypothesis.id, report }
    } catch (error) {
      if (error.driverTimeout === true) throw error
      this.event({ type: 'loop-error', phase: 'investigate', branch: label, error: String(error?.message ?? error) })
      return { hypothesis_id: hypothesis.id, report: null }
    } finally {
      this.inFlight -= 1
    }
  }

  /** 收敛结果 → 8 字段包（确定性模板；不追加模型调用）。 */
  composePacket(hypotheses, reports, selected, reason) {
    const selectedReport = selected === null ? null : reports.find((entry) => entry.hypothesis_id === selected.hypothesis_id)?.report ?? null
    // selected 是报告对象；假设原文要回假设清单取（report 上没有 statement 字段）。
    const selectedHypothesis = selected === null ? null : hypotheses.find((hypothesis) => hypothesis.id === selected.hypothesis_id) ?? null
    const verifiedFacts = selectedReport === null
      ? reports.flatMap((entry) => entry.report?.evidence ?? []).slice(0, 12)
      : (selectedReport.evidence ?? [])
    const unresolved = hypotheses
      .filter((hypothesis) => selected === null || hypothesis.id !== selected.hypothesis_id)
      .map((hypothesis) => {
        const report = reports.find((entry) => entry.hypothesis_id === hypothesis.id)?.report
        return report === null || report === undefined ? `${hypothesis.id}: investigation report missing` : `${hypothesis.id}: ${report.verdict} — ${hypothesis.statement}`
      })
    const implicated = (selectedReport?.implicated_files ?? []).filter((file) => typeof file === 'string')
    return {
      goal_spec: { goal: "make the repository's test suite pass, conforming to README.md as the authoritative spec", constraints: GOAL_CONSTRAINTS },
      goal_status: { phase: 'branch-search-complete', hypotheses_investigated: hypotheses.length, selection: selected === null ? 'none' : reason },
      selected_hypothesis: selectedHypothesis === null ? '' : `${selectedHypothesis.id}: ${selectedHypothesis.statement}`,
      verified_facts: verifiedFacts,
      evidence_refs: selectedReport === null ? [] : [`branch-report:${selectedReport.hypothesis_id ?? selected.hypothesis_id}`],
      artifact_refs: implicated,
      unresolved_questions: unresolved,
      recommended_next_action: selected === null
        ? 'No hypothesis survived investigation. Investigate the failing suite directly, fix the root cause under src/, then run the suite.'
        : `Fix the confirmed root cause (${implicated.join(', ') || 'see verified_facts'}) under src/ per the README spec, then run the test suite to verify.`,
    }
  }

  /** 新建一条自持会话（独立上下文；工具走独立受限执行器，观察态共享）。 */
  newConversation(label, context, maxTurns) {
    const tools = new WorkspaceTools({
      workspace: this.tools.workspace,
      onEvent: (event) => this.event({ ...event, loop: label }),
      allowedTools: new Set(BRANCH_TOOLSET),
      sharedState: this.tools.sharedState,
    })
    return { label, context, maxTurns, tools, turns: 0 }
  }

  /**
   * 自持会话的 ReAct 循环（这是 B 的独立实现——不经过 UnifiedDriver）。
   * @returns {Promise<string>} 收口文本（无 tool calls 的最终响应；轮次耗尽时为
   *   最后一次无工具响应或空串，由调用方如实解析）
   */
  async driveConversation(conversation, allowedTools) {
    for (;;) {
      this.checkDeadline(`driving conversation ${conversation.label}`)
      conversation.turns += 1
      if (conversation.turns > conversation.maxTurns) {
        this.event({ type: 'loop-limit', conversation: conversation.label, limit: 'max-turns' })
        return conversation.lastText ?? ''
      }
      this.inFlight += 1
      let message
      try {
        this.checkDeadline('model request')
        const response = await this.model.chat({
          messages: conversation.context,
          tools: toolSchemas().filter((schema) => allowedTools.has(schema.function.name)),
          maxTokens: DRIVER_CAPS.requestMaxTokens,
          seed: this.seed,
          timeoutMs: Math.min(180_000, Math.max(30_000, this.remainingMs())),
        })
        message = response.message
      } finally {
        this.inFlight -= 1
      }
      conversation.context.push(normalizeAssistant(message))
      const toolCalls = message.tool_calls ?? []
      if (toolCalls.length === 0) {
        conversation.lastText = typeof message.content === 'string' ? message.content : ''
        return conversation.lastText
      }
      await this.executeCalls(conversation, toolCalls)
    }
  }

  async executeCalls(conversation, toolCalls) {
    const outcomes = await Promise.all(toolCalls.map(async (call) => {
      let args = {}
      try {
        args = call.function?.arguments === undefined ? {} : JSON.parse(call.function.arguments)
      } catch {
        args = { __raw: call.function?.arguments }
      }
      const outcome = await conversation.tools.execute(call.function?.name ?? 'unknown', args)
      return { call, outcome }
    }))
    for (const { call, outcome } of outcomes) {
      conversation.context.push({ role: 'tool', tool_call_id: call.id, content: outcome.output })
    }
  }
}

function normalizeAssistant(message) {
  const content = typeof message.content === 'string' && message.content.trim() === '' ? null : (message.content ?? null)
  return {
    role: 'assistant',
    content,
    ...(message.tool_calls !== undefined && message.tool_calls.length > 0 ? { tool_calls: message.tool_calls } : {}),
  }
}

function cleanHypotheses(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry) => entry !== null && typeof entry.statement === 'string' && entry.statement.trim() !== '')
    .map((entry, index) => ({
      id: typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id : `h${index + 1}`,
      statement: entry.statement,
      modules: Array.isArray(entry.modules) ? entry.modules : [],
      how_to_confirm: typeof entry.how_to_confirm === 'string' ? entry.how_to_confirm : undefined,
    }))
}
