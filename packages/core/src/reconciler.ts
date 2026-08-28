import { ReconcileError } from './errors.ts'
import type { ProjectionStep, VerdictEvent } from './schema/events.ts'
import {
  allSatisfied,
  unsatisfiedHumanCriterion,
  satisfiedIdsOf,
  type GungnirState,
} from './schema/state.ts'

/**
 * Reconciler 决策函数（一阶段决策表，纯函数）。
 *
 * 输入：fold 产出的 GungnirState（phase 必须是决策点 VERIFYING / REVALIDATING）
 * 与刚结束一轮的 verdict 事件流；输出：唯一 Decision。
 *
 * 阶梯强制规则（一阶段可执行形式）：
 * - L4（llm_rubric）的 PASS 在"生效判定"里降级为 PARTIAL（effectiveOutcome）——
 *   纯 semantic 判定不足以支撑任何 criterion 的最终 PASS；
 * - COMPLETE 要求存在 L1/L2 的 PASS verdict 佐证（deterministicPassSeen）。
 *
 * 熔断守卫（任一触发即不允许继续 commit，只能 BLOCKED / NEEDS_HUMAN）：
 * - budget.maxRounds 用尽 / budget.maxVerifierRuns 用尽；
 * - roundsNoImprovement ≥ 3（连续无进展）；
 * - consecutiveInconclusive ≥ 3（verifier 连续无法判定）。
 */

export const ROUNDS_NO_IMPROVEMENT_LIMIT = 3
export const CONSECUTIVE_INCONCLUSIVE_LIMIT = 3
/** 同一 action 允许的最大重试次数（RETRY 后第三次仍失败 → BLOCKED）。 */
export const MAX_ACTION_RETRIES = 2

export interface Decision {
  readonly kind:
    | 'ADVANCE'      // commit 投影中的下一个 action
    | 'REPLAN'       // 重生成 projection（前提失效 / 投影耗尽 / 新失败签名）
    | 'RETRY'        // 同 action 重新提交一轮（transient 判定通过且未超限）
    | 'BLOCKED'      // 停轮，native goal 应 blocked
    | 'NEEDS_HUMAN'  // 停轮等用户
    | 'REVALIDATE'   // 全部 criteria PASS → GOAL_REVALIDATION 全量重验
    | 'COMPLETE'     // REVALIDATING 中全量重验全 PASS 且有 L1/L2 佐证
  readonly rationale: string
  /** BLOCKED 时的机器可读 blocker code（lower-kebab-case） */
  readonly blocker: string | null
  /** RETRY 时要重提交的 actionId */
  readonly retryActionId: string | null
  /** ADVANCE 时投影中的下一个 step（null = 不适用） */
  readonly nextStep: ProjectionStep | null
}

function decision(kind: Decision['kind'], rationale: string): Decision {
  return { kind, rationale, blocker: null, retryActionId: null, nextStep: null }
}

function blocked(blocker: string, rationale: string): Decision {
  return { kind: 'BLOCKED', rationale, blocker, retryActionId: null, nextStep: null }
}

function needsHuman(rationale: string): Decision {
  return { kind: 'NEEDS_HUMAN', rationale, blocker: null, retryActionId: null, nextStep: null }
}

/** 投影中 currentAction 之后的下一个 step；action 无 stepId 或已是最后一步 → null。 */
export function nextStepOf(state: GungnirState): ProjectionStep | null {
  const projection = state.projection
  const action = state.currentAction
  if (projection === null || action === null) return null
  if (action.stepId === null) return null
  const index = projection.steps.findIndex((step) => step.id === action.stepId)
  if (index < 0) return null
  return projection.steps[index + 1] ?? null
}

/**
 * 核心决策函数。调用方约定：roundVerdicts 是刚结束一轮（或 REVALIDATING 全量重验）
 * 落盘的 verdict 事件；phase 必须处于决策点。
 */
export function reconcile(state: GungnirState, roundVerdicts: readonly VerdictEvent[]): Decision {
  if (state.spec === null || state.phase === null) {
    throw new ReconcileError('no-spec', 'reconcile requires a committed spec')
  }
  if (state.phase !== 'VERIFYING' && state.phase !== 'REVALIDATING') {
    throw new ReconcileError('phase', `reconcile is only valid at decision points (VERIFYING/REVALIDATING), got ${state.phase}`)
  }
  const action = state.currentAction
  if (action === null) {
    throw new ReconcileError('no-action', 'reconcile requires a committed action')
  }
  const budget = state.spec.budget

  // 0. human gates：verdict 升格，或当前 action 直接以 human 谓词为目标
  if (roundVerdicts.some((v) => v.outcome === 'NEEDS_HUMAN')) {
    return needsHuman('a verifier escalated to NEEDS_HUMAN')
  }
  const targetedHuman = action.targetsCriteria.some((id) => {
    const criterion = state.criteria[id]
    return criterion !== undefined && criterion.criterion.predicate.kind === 'human'
  })
  if (targetedHuman) {
    return needsHuman('committed action targets a human predicate (L5 has no machine verdict)')
  }

  // 1. 全部 criteria 满足 → 进入/维持 REVALIDATE 路径（成功路径不受熔断限制：不再 commit）
  if (allSatisfied(state)) {
    if (state.phase === 'VERIFYING') return decision('REVALIDATE', 'all success criteria satisfied; entering GOAL_REVALIDATION')
    if (state.deterministicPassSeen) {
      return decision('COMPLETE', 'full re-validation passed with deterministic (L1/L2) corroboration')
    }
    return blocked('ladder-no-deterministic-evidence', 'all criteria pass but no L1/L2 PASS verdict corroborates (ladder rule)')
  }

  // 2. 熔断守卫（顺序即优先级：硬预算 → 无进展 → verifier 失能）
  if (budget.maxRounds !== null && state.currentRound >= budget.maxRounds) {
    return blocked('budget-exhausted', `round ${state.currentRound} reached budget.maxRounds ${budget.maxRounds}`)
  }
  if (budget.maxVerifierRuns !== null && state.verdictRuns >= budget.maxVerifierRuns) {
    return blocked('verifier-budget-exhausted', `verdict runs ${state.verdictRuns} reached budget.maxVerifierRuns ${budget.maxVerifierRuns}`)
  }
  if (state.roundsNoImprovement >= ROUNDS_NO_IMPROVEMENT_LIMIT) {
    return blocked('no-progress', `no new criterion satisfied for ${state.roundsNoImprovement} consecutive rounds`)
  }
  if (state.consecutiveInconclusive >= CONSECUTIVE_INCONCLUSIVE_LIMIT) {
    return needsHuman(`verifier returned INCONCLUSIVE ${state.consecutiveInconclusive} times in a row`)
  }

  // 3. REVALIDATING 中出现回归：其余 criteria 未全满足 → 回 EXECUTING 重新规划
  if (state.phase === 'REVALIDATING') {
    return { ...decision('REPLAN', 're-validation found a regression; rebuilding projection'), nextStep: null }
  }

  // 4. 环境漂移：artifact verifier 明确报告 STALE → 投影前提失效
  if (roundVerdicts.some((v) => v.outcome === 'STALE')) {
    return decision('REPLAN', 'a verdict reported STALE (observed world drifted from projection premise)')
  }

  // 5. 未满足的 human 谓词挡住完成（机器侧已全部就绪）→ NEEDS_HUMAN（L5 无机器 verdict）
  const pendingHuman = unsatisfiedHumanCriterion(state)
  const allMachineSatisfied = satisfiedIdsOf(state).length === state.spec.successCriteria.filter((c) => c.predicate.kind !== 'human').length
  if (pendingHuman !== null && allMachineSatisfied) {
    return needsHuman(`criterion "${pendingHuman.id}" requires human judgement (L5 has no machine verdict)`)
  }

  // 6. 当前 action 的全部 targets 满足 → ADVANCE（投影耗尽则 REPLAN）
  const targetsSatisfied = action.targetsCriteria.every((id) => state.criteria[id]?.satisfied === true)
  if (targetsSatisfied) {
    const next = nextStepOf(state)
    if (next !== null) return { ...decision('ADVANCE', `all targeted criteria pass; committing next step "${next.id}"`), nextStep: next }
    return decision('REPLAN', 'all targeted criteria pass but the projection is exhausted')
  }

  // 7. 失败处理：transient 判定（同签名复发）→ RETRY；新签名 → REPLAN；重试耗尽 → BLOCKED
  const failures = action.targetsCriteria
    .map((id) => state.criteria[id])
    .filter((criterionState): criterionState is NonNullable<typeof criterionState> =>
      criterionState !== undefined && criterionState.lastOutcome === 'FAIL',
    )
  if (failures.length > 0) {
    const allRepeated = failures.every(
      (criterionState) => criterionState.prevFailSignature !== null && criterionState.prevFailSignature === criterionState.lastFailSignature,
    )
    if (action.retried < MAX_ACTION_RETRIES) {
      if (allRepeated) {
        return { ...decision('RETRY', `same failure signature repeated on ${failures.map((c) => c.criterion.id).join(',')} (transient)`), retryActionId: action.actionId }
      }
      return decision('REPLAN', 'new failure signature: projection premise may be wrong')
    }
    return blocked('stuck', `action "${action.actionId}" still failing after ${MAX_ACTION_RETRIES} retries`)
  }

  // 8. 无法判定：INCONCLUSIVE → 重试或交人
  const hasInconclusive = roundVerdicts.some((v) => v.outcome === 'INCONCLUSIVE')
  if (hasInconclusive) {
    if (action.retried < MAX_ACTION_RETRIES) {
      return { ...decision('RETRY', 'verifier could not judge; re-running the action'), retryActionId: action.actionId }
    }
    return needsHuman('verifier repeatedly INCONCLUSIVE on this action')
  }

  // 9. 剩余未决（PARTIAL / 缺 verdict）→ 重试或 BLOCKED
  if (action.retried < MAX_ACTION_RETRIES) {
    return { ...decision('RETRY', 'targeted criteria unresolved (PARTIAL or unverified); re-running'), retryActionId: action.actionId }
  }
  return blocked('verifier-unresolved', 'targeted criteria remain unresolved after retries')
}

/** DecisionKind 到 status.phase 的投影（插件 append gungnir/status 时的依据）。 */
export function decisionToPhase(kind: Decision['kind']): GungnirState['phase'] {
  switch (kind) {
    case 'ADVANCE':
    case 'RETRY':
    case 'REPLAN':
      return 'EXECUTING'
    case 'BLOCKED':
      return 'BLOCKED'
    case 'NEEDS_HUMAN':
      return 'NEEDS_HUMAN'
    case 'REVALIDATE':
      return 'REVALIDATING'
    case 'COMPLETE':
      return 'COMPLETE'
  }
}
