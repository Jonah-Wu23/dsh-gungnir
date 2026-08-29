import {
  assessWrapup,
  buildMafMessage,
  emptyPassivePlane,
  isInsideWorkspace,
  observeToolEvent,
  recordCapture,
  recordCompletionClaim,
  type CommandObservation,
  type PassivePlaneState,
  type S2Capture,
  type S2VerifyContext,
  type ToolEventView,
} from '@gungnir/core'
import type { AgentLedger } from './ledger.ts'

/**
 * 被动面运行时（三阶段 P1，ADR-0017）：
 * - Observe：tools/result 结构事件 → S1 不变量观测 → gungnir/invariant 落账；
 * - Prove：update_goal(complete/blocked)（wrapup seam，适配点②）→ wrapup 评估
 *   （S1 纯函数 + S2 捕获校验，L4 禁用）；
 * - Intervene：仅证据冲突时注入一条 MAF（AP-6，任务层事实），其余静默。
 *
 * 触发器纪律（Let It Go 边界）：输入只有工具名/参数与工具结果文本（环境输出），
 * 绝不从模型文本识别完成声明。
 */

export interface PassivePlaneDeps {
  ledgerOf(agentId: string): AgentLedger | undefined
  ensureLedger(agentId: string): Promise<AgentLedger>
  /** 注入一条插件源消息（下一 step 领取；MAF 的唯一出口） */
  injectMessage(agentId: string, text: string): void
  runCommand(command: string, timeoutMs: number): Promise<CommandObservation>
  readFile(path: string): Promise<string | null>
  workspaceRoot: string
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void
}

/** update_goal 完成类动作（wrapup 触发点）。 */
export const WRAPUP_ACTIONS = ['complete', 'blocked']

export class PassivePlaneRuntime {
  private readonly planes = new Map<string, PassivePlaneState>()

  constructor(private readonly deps: PassivePlaneDeps) {}

  private plane(agentId: string): PassivePlaneState {
    let plane = this.planes.get(agentId)
    if (plane === undefined) {
      plane = emptyPassivePlane()
      this.planes.set(agentId, plane)
    }
    return plane
  }

  /** tools/result 观察点：S1 不变量派生 + 落账 + wrapup 触发。 */
  async onToolResult(agentId: string, view: { name: string; arguments?: Record<string, unknown>; text: string; isError: boolean; callId: string }): Promise<void> {
    const event: ToolEventView = {
      type: 'tool/result',
      turn: 0,
      step: 0,
      name: view.name,
      callId: view.callId,
      text: view.text,
      isError: view.isError,
      ...(view.arguments !== undefined ? { args: view.arguments } : {}),
    }
    const current = this.plane(agentId)
    const { state: next, observations } = observeToolEvent(current, event, this.deps.workspaceRoot)
    this.planes.set(agentId, next)
    // ledger 可能尚未就绪（agent/created 的异步 open 与首个工具事件竞态）：缺则现场开
    let ledger = this.deps.ledgerOf(agentId)
    if (ledger === undefined) {
      try {
        ledger = await this.deps.ensureLedger(agentId)
      } catch (error) {
        this.deps.log('error', `passive ledger open failed for ${agentId} (observations kept in memory)`, error)
      }
    }
    if (ledger !== undefined) {
      for (const observation of observations) {
        await ledger.append({
          type: 'gungnir/invariant',
          invariantId: observation.invariantId,
          severity: observation.severity,
          turn: 0,
          step: 0,
          ref: observation.ref,
          detail: observation.detail,
        })
      }
    }
    // wrapup seam（适配点②）：update_goal complete/blocked 的工具结果 → 评估 + 可能介入
    const action = view.arguments?.['action']
    if (view.name === 'update_goal' && typeof action === 'string' && WRAPUP_ACTIONS.includes(action)) {
      await this.assessAtWrapup(agentId)
    }
  }

  /** gungnir_capture 落地：快照约束文件基线 + 记录捕获 + 落账。幂等：已捕获则拒绝（不重置基线）。 */
  async capture(agentId: string, raw: S2Capture): Promise<void> {
    const current = this.plane(agentId)
    if (current.capture !== null) {
      throw new Error('capture already recorded — gungnir_capture is one-shot; do not call it again')
    }
    const snapshots: Record<string, string> = {}
    const files = new Set<string>(raw.constraints.noModifyFiles)
    if (raw.constraints.noNewDeps) {
      for (const manifest of ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'requirements.txt', 'pyproject.toml']) {
        files.add(manifest)
      }
    }
    for (const file of files) {
      const content = await this.deps.readFile(file)
      if (content !== null) snapshots[file] = content
    }
    const next = recordCapture(this.plane(agentId), raw, snapshots)
    this.planes.set(agentId, next)
    const ledger = await this.deps.ensureLedger(agentId)
    await ledger.append({ type: 'gungnir/capture', capture: raw })
  }

  /** wrapup 评估：S1（纯）+ S2（异步校验）；冲突则落 intervention + 注入 MAF。评估永不静默中止。 */
  private async assessAtWrapup(agentId: string): Promise<void> {
    const state = recordCompletionClaim(this.plane(agentId))
    this.planes.set(agentId, state)
    const s2Ctx: S2VerifyContext = {
      runCommand: async (command, timeoutMs) => {
        try {
          const result = await this.deps.runCommand(command, timeoutMs)
          return { exitCode: result.exitCode }
        } catch (error) {
          // 沙箱拒绝/执行器故障 → 折为 verify-command-failed 冲突（M1 修复：
          // 绝不静默中止评估——否则 C2b 的 S2 漏检不可测）
          const message = error instanceof Error ? error.message : String(error)
          const blocked = /denied|EPERM|runnerFailed|sandbox/i.test(message)
          return { exitCode: -1, blocked }
        }
      },
      readFile: (path) => this.deps.readFile(path),
      now: () => Date.now(),
    }
    const conflicts = await assessWrapup(state, s2Ctx)
    // ledger 写入尽力而为（缺则现场开）；MAF 注入不依赖 ledger
    let ledger = this.deps.ledgerOf(agentId)
    if (ledger === undefined) {
      try {
        ledger = await this.deps.ensureLedger(agentId)
      } catch (error) {
        this.deps.log('error', `passive ledger open failed at wrapup for ${agentId}`, error)
      }
    }
    if (conflicts.length > 0) {
      const feedback = buildMafMessage(conflicts)
      this.deps.injectMessage(agentId, feedback)
      this.deps.log('info', `passive intervention injected for ${agentId}: ${conflicts.map((c) => c.kind).join(', ')}`)
      if (ledger !== undefined) {
        await ledger.append({
          type: 'gungnir/intervention',
          turn: 0,
          step: 0,
          conflicts,
          feedback,
        })
      }
    }
    if (ledger !== undefined) {
      await ledger.append({
        type: 'gungnir/assessment',
        outcome: conflicts.length > 0 ? 'intervene' : 'silent',
        turn: 0,
        step: 0,
        conflicts,
      })
    }
  }
}

export { isInsideWorkspace }
