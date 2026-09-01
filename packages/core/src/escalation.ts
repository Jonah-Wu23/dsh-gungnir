/**
 * 例外升级（Escalation）域逻辑 —— 三阶段 P2（ADR-0021，BPAR v0）。
 *
 * 触发信号（全部为结构事件派生的计数性事实，Let It Go 边界：零关键词嗅探模型文本）：
 * - SIG-1 claim/evidence 冲突：wrapup 结构事件时契约判据无确定性证据支撑，或被判
 *   FAIL/UNVERIFIABLE（由被动面 claim-check 产出 ConflictDetail 后触发）；
 * - SIG-2 重复失败：同 errorSignature（工具名 + 拒绝/失败标记的结构签名）连续 ≥3；
 * - SIG-3 无效浪费：相同未变化文件重读 ≥3 次；
 * - SIG-4 停滞：连续 N（预注册，建议 8）步无任何工具结果产出。
 *
 * 动作（升级裁决表，纯函数）：
 * - maf    —— 只注入任务级反馈（AP-6），不切模式（E2/E3 都有）；
 * - verify —— SIG-1 且契约有 M-A 模板供给：harness 侧跑 probe 再终判（E2 独有），
 *             驱动模式切换至 VERIFY；
 * - recover—— SIG-2 持续（同一签名已 MAF 过仍不收敛）：换档指令 + 模式切换 RECOVER
 *             （E2 独有，预算内）。
 *
 * 预算（预注册冻结）：每 session 升级（verify+recover）预算 ≤2，耗尽后只 MAF 不切模式。
 * 计数器全部在插件侧内存推进（mirror 进 ledger 的 gungnir/invariant 事件），本模块只
 * 提供纯推进与裁决函数。
 */

// ---- 信号与动作类型 ---------------------------------------------------------------

import { COMMAND_TOOL_NAMES } from './passive.ts'

export const ESCALATION_SIGNAL_IDS = ['sig-1', 'sig-2', 'sig-3', 'sig-4'] as const
export type EscalationSignalId = (typeof ESCALATION_SIGNAL_IDS)[number]

export type EscalationActionKind = 'maf' | 'verify' | 'recover'

export interface EscalationSignal {
  readonly signal: EscalationSignalId
  /** 触发的计数（审计字段：连续失败数 / 重读数 / 停滞步数） */
  readonly count: number
  /** 任务级反馈（AP-6：进 prompt 的材料，零控制面内部概念） */
  readonly feedback: string
  /** 处置动作：maf = 只注入反馈；recover = 反馈 + 升级换档（E2，预算内） */
  readonly action: 'maf' | 'recover'
}

export interface EscalationRequest {
  readonly mode: 'VERIFY' | 'RECOVER'
  readonly signal: EscalationSignalId
  readonly feedback: string
}

// ---- 预注册阈值（P2-1 冻结；与计划 §5 一致） ---------------------------------------

/** SIG-2：同 errorSignature 连续失败次数达到此值触发 MAF。 */
export const SIG2_CONSECUTIVE_MAF = 3
/** SIG-2：同签名已 MAF 后仍继续失败达到此值触发 RECOVER（换档）。 */
export const SIG2_CONSECUTIVE_RECOVER = 5
/** SIG-3：同文件未变化重读次数达到此值触发 MAF。 */
export const SIG3_UNCHANGED_READS = 3
/** SIG-4：连续无工具结果的 step 数达到此值触发 MAF（N 预注册）。 */
export const SIG4_STALL_STEPS = 8
/** 每 session 升级预算（verify + recover 合计 ≤2，ADR-0021/P2 §2）。 */
export const SESSION_ESCALATION_BUDGET = 2

// ---- 错误签名（结构性：工具名 + 失败标记，非文本嗅探） -----------------------------

/** 命令工具失败的结构签名：'tool:marker' 形（如 'pwsh:sandbox-denied'）。 */
export function errorSignatureOf(toolName: string, text: string, isError: boolean): string | null {
  if (!isError) return null
  // 拒绝优先（sandbox-denied 是环境事实；EPERM 墙的 C-1 场景签名稳定）
  if (text.includes('denied') || text.includes('EPERM')) return `${toolName}:sandbox-denied`
  if (/Error: |error TS\d+|npm ERR!|\bFAIL\b|✖/.test(text)) return `${toolName}:failure`
  return `${toolName}:error`
}

// ---- 计数状态 ----------------------------------------------------------------------

export interface EscalationCounters {
  /** SIG-2：最近一次失败签名 */
  lastErrorSignature: string | null
  /** SIG-2：当前连续失败数（同签名才累积） */
  consecutiveErrors: number
  /** SIG-2：已就哪个签名发过 MAF（同签名不重复 MAF，断掉后重置） */
  mafSentForSignature: string | null
  /** SIG-2：已就哪个签名发过 RECOVER */
  recoverSentForSignature: string | null
  /** SIG-3：各路径的未变化重读计数 */
  unchangedReads: Record<string, number>
  /** SIG-3：最近一次读该路径的结果文本 hash（null = 未记录；写事件清除） */
  readHashes: Record<string, string | null>
  /** SIG-3：已就哪个路径发过 MAF */
  mafSentForPath: string | null
  /** SIG-4：连续无工具结果的 step 数 */
  stepsWithoutToolCall: number
  /** SIG-4：已发过 MAF（触发后重置再计，防每步轰炸） */
  stallMafArmed: boolean
  /** 升级预算（verify + recover 合计） */
  escalationBudgetUsed: number
  /** SIG-1 触发次数（审计） */
  claimConflictsSeen: number
}

export function emptyEscalationCounters(): EscalationCounters {
  return {
    lastErrorSignature: null,
    consecutiveErrors: 0,
    mafSentForSignature: null,
    recoverSentForSignature: null,
    unchangedReads: {},
    readHashes: {},
    mafSentForPath: null,
    stepsWithoutToolCall: 0,
    stallMafArmed: true,
    escalationBudgetUsed: 0,
    claimConflictsSeen: 0,
  }
}

/** 读类工具（SIG-3 的作用面）。 */
export const READ_TOOL_NAMES = new Set(['read', 'read_file', 'view'])

/** 写类工具（清除该路径的 SIG-3 计数——内容变了，重读就是合理的）。 */
export const WRITE_RESET_TOOL_NAMES = new Set(['write', 'edit', 'multiedit', 'str_replace_editor', 'copy', 'move', 'rm', 'notebook_edit'])

// ---- 事件推进（纯函数） -------------------------------------------------------------

export interface EscalationEventView {
  readonly type: 'tool/result' | 'tool/call'
  readonly name: string
  readonly text?: string
  readonly isError?: boolean
  /** tool/call 有效：写工具的目标路径 */
  readonly path?: string
}

/**
 * 单条结构事件推进升级计数。返回 (newCounters, signals)——每次最多一条 SIG-2/3/4
 * 信号（按优先级：SIG-2 重复失败 > SIG-3 无效浪费；SIG-4 由 observeStep 推进）。
 */
export function observeEscalationEvent(
  counters: EscalationCounters,
  event: EscalationEventView,
): { counters: EscalationCounters; signals: EscalationSignal[] } {
  let next: EscalationCounters = { ...counters, unchangedReads: { ...counters.unchangedReads }, readHashes: { ...counters.readHashes } }
  const signals: EscalationSignal[] = []

  if (event.type === 'tool/result') {
    const signature = errorSignatureOf(event.name, event.text ?? '', event.isError === true)
    if (signature !== null) {
      next.consecutiveErrors = signature === next.lastErrorSignature ? next.consecutiveErrors + 1 : 1
      next.lastErrorSignature = signature
      if (next.consecutiveErrors >= SIG2_CONSECUTIVE_MAF && next.mafSentForSignature !== signature) {
        next.mafSentForSignature = signature
        signals.push({
          signal: 'sig-2',
          count: next.consecutiveErrors,
          feedback: buildSig2Maf(signature, next.consecutiveErrors),
          action: 'maf',
        })
      } else if (next.consecutiveErrors >= SIG2_CONSECUTIVE_RECOVER && next.recoverSentForSignature !== signature && next.mafSentForSignature === signature) {
        next.recoverSentForSignature = signature
        signals.push({
          signal: 'sig-2',
          count: next.consecutiveErrors,
          feedback: buildSig2Recover(signature, next.consecutiveErrors),
          action: 'recover',
        })
      }
    } else {
      // 干净结果：命令成功 = 失败连击中断（同一堵墙被绕过的结构性信号）
      if (COMMAND_TOOL_NAMES.has(event.name)) {
        next.consecutiveErrors = 0
        next.lastErrorSignature = null
      }
      // SIG-3：同文件未变化重读（结果文本 hash 一致才算）
      if (READ_TOOL_NAMES.has(event.name) && event.text !== undefined) {
        const path = event.text.slice(0, 120)
        const hash = simpleHash(event.text)
        const previous = next.readHashes[path]
        if (previous === hash) {
          next.unchangedReads[path] = (next.unchangedReads[path] ?? 0) + 1
          if (next.unchangedReads[path] >= SIG3_UNCHANGED_READS && next.mafSentForPath !== path) {
            next.mafSentForPath = path
            signals.push({
              signal: 'sig-3',
              count: next.unchangedReads[path],
              feedback: buildSig3Maf(next.unchangedReads[path]),
              action: 'maf',
            })
          }
        } else {
          next.readHashes[path] = hash
          next.unchangedReads[path] = 0
        }
      }
    }
  } else if (event.type === 'tool/call') {
    if (event.path !== undefined && WRITE_RESET_TOOL_NAMES.has(event.name)) {
      // 写事件 = 模型在做实事：SIG-2 失败连击与 SIG-3 重读计数都中断（内容已变化；
      // 健康修 bug 任务的"测试失败→改→再跑失败"不得误判为空转）
      next.consecutiveErrors = 0
      next.lastErrorSignature = null
      for (const key of Object.keys(next.unchangedReads)) {
        if (key.includes(event.path)) {
          next.unchangedReads[key] = 0
          next.readHashes[key] = null
        }
      }
    }
  }
  return { counters: next, signals }
}

/**
 * step 推进（SIG-4）：每个 pre-step 调用。toolActivitySinceLastStep=true 表示上一个
 * step 内产出了工具结果（证据活动）→ 计数器清零；否则累加。
 */
export function observeEscalationStep(counters: EscalationCounters, toolActivitySinceLastStep: boolean): { counters: EscalationCounters; signals: EscalationSignal[] } {
  const next: EscalationCounters = { ...counters }
  const signals: EscalationSignal[] = []
  if (toolActivitySinceLastStep) {
    next.stepsWithoutToolCall = 0
    next.stallMafArmed = true
  } else {
    next.stepsWithoutToolCall += 1
  }
  if (next.stallMafArmed && next.stepsWithoutToolCall >= SIG4_STALL_STEPS) {
    next.stallMafArmed = false
    signals.push({ signal: 'sig-4', count: next.stepsWithoutToolCall, feedback: buildSig4Maf(next.stepsWithoutToolCall), action: 'maf' })
  }
  return { counters: next, signals }
}

// ---- 裁决表 -------------------------------------------------------------------------

/**
 * SIG-1 裁决：wrapup claim-check 冲突 → MAF；契约有 M-A 模板供给且升级预算允许 →
 * 升级 VERIFY（harness 侧跑 probe 再终判）。
 */
export function decideSig1(
  counters: EscalationCounters,
  hasMaTemplate: boolean,
  mafText: string,
): { counters: EscalationCounters; maf: string; request: EscalationRequest | null } {
  const next: EscalationCounters = { ...counters, claimConflictsSeen: counters.claimConflictsSeen + 1 }
  const budgetLeft = SESSION_ESCALATION_BUDGET - next.escalationBudgetUsed
  if (hasMaTemplate && budgetLeft > 0) {
    next.escalationBudgetUsed += 1
    return {
      counters: next,
      maf: mafText,
      request: { mode: 'VERIFY', signal: 'sig-1', feedback: mafText },
    }
  }
  return { counters: next, maf: mafText, request: null }
}

/** SIG-2 持续裁决：同一签名已 MAF 后仍不收敛 → RECOVER（预算内）。 */
export function decideRecover(counters: EscalationCounters, feedback: string): { counters: EscalationCounters; request: EscalationRequest | null } {
  const next: EscalationCounters = { ...counters }
  const budgetLeft = SESSION_ESCALATION_BUDGET - next.escalationBudgetUsed
  if (budgetLeft > 0) {
    next.escalationBudgetUsed += 1
    return { counters: next, request: { mode: 'RECOVER', signal: 'sig-2', feedback } }
  }
  return { counters: next, request: null }
}

// ---- MAF 文本（AP-6：任务层事实；供插件直接注入；核心提供构建以免插件漂移） ----------

export function buildSig2Maf(signature: string, count: number): string {
  return `The same command has failed ${count} consecutive times with the same error (${signature}). Re-check the command itself and the environment before retrying — repeating the identical action will not change the outcome.`
}

export function buildSig2Recover(signature: string, count: number): string {
  return `The same failure (${signature}) has persisted after ${count} attempts. Stop repeating the current approach: step back, re-read the task specification, and switch to a different strategy before continuing.`
}

export function buildSig3Maf(count: number): string {
  return `You have re-read the same file content ${count} times without any change. If you are chasing an error reported elsewhere, the source of that error is probably not this file — look at the component that actually produces the reported symptom.`
}

export function buildSig4Maf(steps: number): string {
  return `You have gone ${steps} consecutive steps without any tool action producing a result. Take the next action now (run a command, read a file, or make a change) to make progress.`
}

// ---- 内部工具 ------------------------------------------------------------------------

/** 轻量确定性 hash（结构签名用，非密码学）。 */
export function simpleHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return String(h >>> 0)
}
