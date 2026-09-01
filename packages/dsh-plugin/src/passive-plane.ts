import {
  assessS1,
  assessContractCriteria,
  buildMafMessage,
  decideRecover,
  decideSig1,
  emptyEscalationCounters,
  emptyPassivePlane,
  isInsideWorkspace,
  observeEscalationEvent,
  observeEscalationStep,
  observeToolEvent,
  recordCapture,
  recordCompletionClaim,
  unverifiableConflicts,
  type CommandObservation,
  type ConflictDetail,
  type EscalationCounters,
  type EscalationRequest,
  type PassivePlaneState,
  type S2Capture,
  type S2VerifyContext,
  type SuppliedProjection,
  type ToolEventView,
} from '@gungnir/core'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AgentLedger } from './ledger.ts'
import { runTrunkProbe } from './probe-runner.ts'

/**
 * 被动面运行时（三阶段 P1/P2，ADR-0017/0021）：
 * - Observe：tools/result 结构事件 → S1 不变量观测 → gungnir/invariant 落账；
 * - Prove：wrapup seam（update_goal complete/blocked）→ 运行期 claim-check
 *   （S1 + 派发契约判据 + M-C 三态 + E2 的 M-A 隐藏输入探针 VERIFY）；
 * - Intervene：仅证据冲突时注入一条 MAF（AP-6，任务层事实），其余静默；
 * - Escalate（P2，E2）：SIG-1..4 计数信号 → MAF / VERIFY / RECOVER（预算内）。
 *
 * 触发器纪律（Let It Go 边界）：输入只有工具名/参数与工具结果文本（环境输出），
 * 绝不从模型文本识别完成声明。
 */

export interface PassivePlaneDeps {
  ledgerOf(agentId: string): AgentLedger | undefined
  ensureLedger(agentId: string): Promise<AgentLedger>
  /** 注入一条插件源消息（下一 step 领取；MAF 的唯一出口） */
  injectMessage(agentId: string, text: string): void
  /** stdin 可选：探针场景注入通道（泄题纪律：隐藏输入经 stdin 传递，磁盘零落盘） */
  runCommand(command: string, timeoutMs: number, stdin?: string): Promise<CommandObservation>
  readFile(path: string): Promise<string | null>
  workspaceRoot: string
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void
}

export interface PassivePlaneRuntimeOptions {
  /** P2（BPAR v0）：派发契约的 supplied 投影（wrapup claim-check 判据源；null = 无契约） */
  supplied?: SuppliedProjection | null
  /** P2（BPAR v0）：例外升级接线（E2 = true；E3 = false——无 probe/无 RECOVER 升级） */
  escalation?: boolean
}

/** update_goal 完成类动作（wrapup 触发点）。 */
export const WRAPUP_ACTIONS = ['complete', 'blocked']

export class PassivePlaneRuntime {
  private readonly planes = new Map<string, PassivePlaneState>()
  private readonly escalationCounters = new Map<string, EscalationCounters>()
  private readonly pending = new Map<string, EscalationRequest>()
  private readonly stepToolActivity = new Map<string, boolean>()

  constructor(
    private readonly deps: PassivePlaneDeps,
    private readonly options: PassivePlaneRuntimeOptions = {},
  ) {}

  private plane(agentId: string): PassivePlaneState {
    let plane = this.planes.get(agentId)
    if (plane === undefined) {
      plane = emptyPassivePlane()
      this.planes.set(agentId, plane)
    }
    return plane
  }

  private counters(agentId: string): EscalationCounters {
    let counters = this.escalationCounters.get(agentId)
    if (counters === undefined) {
      counters = emptyEscalationCounters()
      this.escalationCounters.set(agentId, counters)
    }
    return counters
  }

  /** 消费性读取升级请求（adaptiveService.routerInputs 每步调用；读完即清，一次性交付）。 */
  pendingEscalation(agentId: string): { mode: 'VERIFY' | 'RECOVER' } | null {
    const pending = this.pending.get(agentId)
    if (pending !== undefined) this.pending.delete(agentId)
    return pending === undefined ? null : { mode: pending.mode }
  }

  /** 审计快照（runner 采集：升级次数/冲突次数）。 */
  escalationStats(agentId: string): { escalationBudgetUsed: number; claimConflictsSeen: number } {
    const counters = this.escalationCounters.get(agentId) ?? emptyEscalationCounters()
    return { escalationBudgetUsed: counters.escalationBudgetUsed, claimConflictsSeen: counters.claimConflictsSeen }
  }

  /** tools/result 观察点：S1 不变量派生 + 升级计数 + 落账 + wrapup 触发。 */
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
    // P2：升级计数推进（SIG-2/3/4 的结构事实；写工具的重置从 arguments 提取路径）
    this.stepToolActivity.set(agentId, true)
    const path = pathFromWriteArgs(view.arguments)
    let counters = this.counters(agentId)
    const first = observeEscalationEvent(counters, { type: 'tool/result', name: view.name, text: view.text, isError: view.isError })
    counters = first.counters
    const writeReset = path !== null
      ? observeEscalationEvent(counters, { type: 'tool/call', name: view.name, path })
      : { counters, signals: [] }
    counters = writeReset.counters
    this.escalationCounters.set(agentId, counters)
    const signals = [...first.signals, ...writeReset.signals]
    for (const signal of signals) {
      await this.dispatchSignal(agentId, signal)
    }
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
    // wrapup seam（适配点②）：update_goal complete/blocked 的工具结果 → 运行期 claim-check
    const action = view.arguments?.['action']
    if (view.name === 'update_goal' && typeof action === 'string' && WRAPUP_ACTIONS.includes(action)) {
      await this.assessAtWrapup(agentId, action as 'complete' | 'blocked', view.callId)
    }
  }

  /** pre-step 观察点（SIG-4 停滞）：每步调用一次；工具活动复位停滞计数。 */
  observeStep(agentId: string): void {
    const activity = this.stepToolActivity.get(agentId) ?? false
    this.stepToolActivity.set(agentId, false)
    const counters = this.counters(agentId)
    const { counters: next, signals } = observeEscalationStep(counters, activity)
    this.escalationCounters.set(agentId, next)
    for (const signal of signals) {
      void this.dispatchSignal(agentId, signal).catch((error: unknown) => this.deps.log('error', `SIG-4 dispatch failed for ${agentId}`, error))
    }
  }

  /** 升级信号处置：MAF 注入（被动面，E2/E3 都有）+ RECOVER 升级（仅 E2，预算内）。 */
  private async dispatchSignal(agentId: string, signal: { signal: string; feedback: string; action: string; count: number }): Promise<void> {
    let counters = this.counters(agentId)
    let upgrade: EscalationRequest | null = null
    if (signal.action === 'recover' && this.options.escalation === true) {
      const decided = decideRecover(counters, signal.feedback)
      counters = decided.counters
      this.escalationCounters.set(agentId, counters)
      upgrade = decided.request
    }
    if (upgrade !== null) this.pending.set(agentId, upgrade)
    this.deps.injectMessage(agentId, signal.feedback)
    this.deps.log('info', `passive escalation signal=${signal.signal} action=${signal.action} upgrade=${upgrade?.mode ?? 'none'} count=${signal.count} for ${agentId}`)
    const ledger = await this.ensureLedgerOrNull(agentId)
    if (ledger !== undefined) {
      await ledger.append({
        type: 'gungnir/intervention',
        turn: 0,
        step: 0,
        conflicts: [{ kind: 'tool-error', ref: `signal:${signal.signal}`, detail: signal.feedback }],
        feedback: signal.feedback,
      })
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

  /** 运行期 claim-check（P2-0②）：S1 + 契约判据 + M-C 三态 + （E2）M-A 探针 VERIFY。
   *  拦截只对 action=complete（完成宣称）生效——blocked 是模型诚实上报，不注入 MAF
   *  （否则 T3 类任务"如实标 blocked"会被重复打扰，构成假阳性源）。
   *  completionCallId：触发本次 wrapup 的 update_goal 调用 callId——S1 完成调用豁免
   *  （BPAR v0.1，ADR-0022）的时序判定依据：报错调用即该调用本身时抑制 tool-error 冲突
   *  （工具拒绝即完成未成立，错误自明，模型自行重试；账本/计数照常）。 */
  private async assessAtWrapup(agentId: string, action: 'complete' | 'blocked', completionCallId: string): Promise<void> {
    const state = recordCompletionClaim(this.plane(agentId))
    this.planes.set(agentId, state)
    const s2Ctx: S2VerifyContext = {
      runCommand: async (command, timeoutMs) => {
        try {
          const result = await this.deps.runCommand(command, timeoutMs)
          return { exitCode: result.exitCode }
        } catch (error) {
          // 沙箱拒绝/执行器故障 → 折为 verify-command-failed 冲突（M1 修复：
          // 绝不静默中止评估——否则 claim-check 漏检不可测）
          const message = error instanceof Error ? error.message : String(error)
          const blocked = /denied|EPERM|runnerFailed|sandbox/i.test(message)
          return { exitCode: -1, blocked }
        }
      },
      readFile: (path) => this.deps.readFile(path),
      now: () => Date.now(),
    }
    const conflicts: ConflictDetail[] = assessS1(state, { completionCallId })
    const supplied = this.options.supplied ?? null
    let probeDetail: string[] = []
    if (supplied !== null) {
      const contract = await assessContractCriteria(supplied, s2Ctx)
      conflicts.push(...contract.conflicts)
      conflicts.push(...unverifiableConflicts(supplied))
      // VERIFY（E2 独有）：契约有 M-A 模板供给时，harness 侧跑隐藏输入探针再终判。
      // E3 无升级接线 → 不跑探针（结构性差异，G3 消融点）。
      if (this.options.escalation === true && supplied.api !== undefined) {
        const template = supplied.api.template
        if (template === 'ledger-reentry' || template === 'effectively-once') {
          const moduleUrl = pathToFileURL(join(this.deps.workspaceRoot, supplied.api.module)).href
          const probe = await runTrunkProbe(
            { runCommand: this.deps.runCommand, workspaceRoot: this.deps.workspaceRoot, log: this.deps.log },
            template,
            moduleUrl,
          )
          if (!probe.ok) {
            probeDetail = probe.failures
            conflicts.push({ kind: 'probe-failed', ref: `api:${supplied.api.template}`, detail: probe.failures.join('; ') })
          }
        } else {
          this.deps.log('warn', `no runtime probe for template ${template} (offline-only); claim-check proceeds on L1/M-C`)
        }
      }
    }
    const hasMaTemplate = supplied?.api !== undefined
    const ledger = await this.ensureLedgerOrNull(agentId)
    if (conflicts.length > 0 && action === 'complete') {
      const feedback = buildMafMessage(conflicts)
      // SIG-1：拦下完成宣称 + MAF；E2 且 M-A 模板供给且预算内 → 升级 VERIFY
      let upgrade: EscalationRequest | null = null
      let counters = this.counters(agentId)
      if (this.options.escalation === true) {
        const decided = decideSig1(counters, hasMaTemplate, feedback)
        counters = decided.counters
        this.escalationCounters.set(agentId, counters)
        upgrade = decided.request
      }
      if (upgrade !== null) this.pending.set(agentId, upgrade)
      this.deps.injectMessage(agentId, feedback)
      this.deps.log('info', `passive claim-check blocked ${agentId}: ${conflicts.map((c) => c.kind).join(', ')}${upgrade !== null ? ` upgrade=${upgrade.mode}` : ''}${probeDetail.length > 0 ? ` probe=${probeDetail.length}` : ''}`)
      if (ledger !== undefined) {
        await ledger.append({ type: 'gungnir/intervention', turn: 0, step: 0, conflicts, feedback })
      }
    } else {
      this.deps.log('info', `passive claim-check ${action === 'blocked' ? 'honest-blocked no-maf' : 'silent'} ${agentId} (completion released)`)
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

  private async ensureLedgerOrNull(agentId: string): Promise<AgentLedger | undefined> {
    let ledger = this.deps.ledgerOf(agentId)
    if (ledger === undefined) {
      try {
        ledger = await this.deps.ensureLedger(agentId)
      } catch (error) {
        this.deps.log('error', `passive ledger open failed for ${agentId}`, error)
      }
    }
    return ledger
  }
}

/** 写类工具路径提取（升级写重置用；多键尝试）。 */
function pathFromWriteArgs(args: Record<string, unknown> | undefined): string | null {
  if (args === undefined) return null
  for (const key of ['file_path', 'path', 'old_path', 'new_path', 'src', 'dest']) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

export { isInsideWorkspace }
