import type { GoalSpec, SuccessCriterion } from './spec.ts'
import type {
  ClaimEvent,
  Phase,
  PlanProjectionEvent,
  ProgressSnapshot,
  VerdictOutcome,
} from './events.ts'

/**
 * GungnirState：fold(events) 的产物——模型可见的一切状态都能从 ledger 事件重建。
 * 这里只放纯数据结构；fold 规则在 fold.ts，决策规则在 reconciler.ts。
 */

/** 单条 success criterion 的观测状态（verdict 逐步收敛的结果）。 */
export interface CriterionState {
  readonly criterion: SuccessCriterion
  /** 生效判定：最近一条 verdict 的 effective outcome === 'PASS'（L4 PASS 已降级为 PARTIAL） */
  satisfied: boolean
  /** 最近一条 verdict 的生效 outcome（经阶梯降级）；无 verdict 为 null */
  lastOutcome: VerdictOutcome | null
  /** 最近一条 verdict 的原始 outcome（未降级） */
  lastRawOutcome: VerdictOutcome | null
  lastVerdictRound: number | null
  /** 上上次失败的签名（transient 判定：prev === last 表示同错误复发） */
  prevFailSignature: string | null
  /** 最近一次失败的签名 */
  lastFailSignature: string | null
  verdictCount: number
}

/** 当前 committed action（每轮恰好一个）。 */
export interface CommittedAction {
  round: number
  actionId: string
  summary: string
  targetsCriteria: readonly string[]
  expectedEvidence: readonly string[]
  projectionId: string | null
  stepId: string | null
  /** 同一 actionId 被重复 commit 的次数（0 = 首次提交；RETRY 语义由此派生） */
  retried: number
}

export interface GungnirState {
  /** null = 尚未提交过 spec */
  spec: GoalSpec | null
  /** null = 无 spec（与 Phase 枚举区分：SPEC_COMMITTED 表示已有 spec 未开轮） */
  phase: Phase | null
  /** 最近 commit 的 round（0 = 尚未开轮） */
  currentRound: number
  currentAction: CommittedAction | null
  /** 最近一份 plan projection（advisory，每轮 reconcile 可重生成） */
  projection: PlanProjectionEvent | null
  readonly criteria: Record<string, CriterionState>
  /** 全局去重集合（evidenceId 冲突 = 损坏） */
  readonly seenEvidenceIds: Set<string>
  /** 累计 verdict 事件数（budget.maxVerifierRuns 的计量口径） */
  verdictRuns: number
  /** 当前轮已落 verdict 条数（commit 前置守卫：上一轮必须有 verdict 才允许开新轮） */
  verdictsInCurrentRound: number
  /** Verifier 连续 INCONCLUSIVE 计数（任何非 INCONCLUSIVE verdict 归零） */
  consecutiveInconclusive: number
  /** 是否出现过 L1/L2 PASS（COMPLETE 的佐证要求） */
  deterministicPassSeen: boolean
  /** PASS 且 kind === 'artifact' 的 verdict 累计条数（progressSnapshot.verifiedArtifacts） */
  verifiedArtifacts: number
  /** 连续无进展轮数（轮末 satisfied 峰值未增长即 +1，增长归零） */
  roundsNoImprovement: number
  /** 内部簿记：历史 satisfied 峰值 */
  maxSatisfiedSeen: number
  /** 当前 blocker code（BLOCKED 时非空） */
  blocker: string
  /** 最近一条 claim（advisory；fold 不参与决策） */
  lastClaim: ClaimEvent | null
  claimsCount: number
  /** 簿记 */
  eventsFolded: number
  lastEventTs: number | null
}

export function emptyState(): GungnirState {
  return {
    spec: null,
    phase: null,
    currentRound: 0,
    currentAction: null,
    projection: null,
    criteria: {},
    seenEvidenceIds: new Set(),
    verdictRuns: 0,
    verdictsInCurrentRound: 0,
    consecutiveInconclusive: 0,
    deterministicPassSeen: false,
    verifiedArtifacts: 0,
    roundsNoImprovement: 0,
    maxSatisfiedSeen: 0,
    blocker: '',
    lastClaim: null,
    claimsCount: 0,
    eventsFolded: 0,
    lastEventTs: null,
  }
}

/** 生效 outcome（阶梯强制规则）：L4 的 PASS 降级为 PARTIAL——纯 semantic 判定不足以支撑最终 PASS。 */
export function effectiveOutcome(outcome: VerdictOutcome, level: number): VerdictOutcome {
  if (level >= 4 && outcome === 'PASS') return 'PARTIAL'
  return outcome
}

/** 当前 satisfied 且谓词为 artifact 的 criterion 数（progressSnapshot.verifiedArtifacts 口径）。 */
export function verifiedArtifactsOf(state: GungnirState): number {
  return Object.values(state.criteria).filter(
    (criterionState) => criterionState.satisfied && criterionState.criterion.predicate.kind === 'artifact',
  ).length
}

/** 当前满足的 criterion id 列表（稳定顺序：spec 声明序）。 */
export function satisfiedIdsOf(state: GungnirState): string[] {
  if (!state.spec) return []
  return state.spec.successCriteria
    .filter((criterion) => state.criteria[criterion.id]?.satisfied === true)
    .map((criterion) => criterion.id)
}

export function allSatisfied(state: GungnirState): boolean {
  if (!state.spec) return false
  return satisfiedIdsOf(state).length === state.spec.successCriteria.length
}

/** 是否存在未满足的 human 谓词 criterion（一阶段只能 NEEDS_HUMAN 出口）。 */
export function unsatisfiedHumanCriterion(state: GungnirState): SuccessCriterion | null {
  if (!state.spec) return null
  for (const criterion of state.spec.successCriteria) {
    if (criterion.predicate.kind === 'human' && state.criteria[criterion.id]?.satisfied !== true) {
      return criterion
    }
  }
  return null
}

/** 从 fold 状态推导 progressSnapshot（与 status 事件中携带的快照同口径，供插件与测试复用）。 */
export function progressSnapshotOf(state: GungnirState): ProgressSnapshot {
  const total = state.spec ? state.spec.successCriteria.length : 0
  return {
    satisfied: satisfiedIdsOf(state).length,
    total: Math.max(total, 1),
    verifiedArtifacts: verifiedArtifactsOf(state),
    roundsNoImprovement: state.roundsNoImprovement,
  }
}
