import { FoldError } from './errors.ts'
import {
  parseGungnirEvent,
  type ClaimEvent,
  type CommitEvent,
  type EvidenceEvent,
  type GungnirEvent,
  type Phase,
  type PlanProjectionEvent,
  type SpecEvent,
  type StatusEvent,
  type VerdictEvent,
} from './schema/events.ts'
import {
  effectiveOutcome,
  emptyState,
  satisfiedIdsOf,
  verifiedArtifactsOf,
  type GungnirState,
} from './schema/state.ts'

/**
 * fold：ledger 事件流 → GungnirState（strict replay）。
 *
 * 铁律：畸形 schema、断序 round、非法 phase 转换、快照不一致……任何违规
 * 立即抛 FoldError 并停在首个坏事件处，绝不静默跳过或猜测修复。
 *
 * 一阶段守卫语义（详见一阶段计划 §4/§6）：
 * - spec：仅允许在无 spec 或上一 spec 已终态（COMPLETE/BLOCKED/NEEDS_HUMAN）时提交；
 *   提交后重置 per-spec 簿记，进入 SPEC_COMMITTED。
 * - plan-projection：advisory，每轮 reconcile 可重生成；允许出现在 SPEC_COMMITTED/
 *   EXECUTING/VERIFYING。
 * - commit：round 严格 +1；每轮恰好一个 action；targets ⊆ spec criteria；
 *   round>1 时上一轮必须落过 ≥1 条 verdict（不许无验证续轮）。
 * - evidence/claim/verdict：round 不得超越当前 commit；verdict 的 verifier kind/level
 *   必须与 criterion 声明一致；FAIL 必须带 errorSignature；evidenceId 全局唯一。
 * - status：按状态机边表转移；快照必须与 fold 派生值一致（单一真理）；
 *   决策字段与目标 phase 强关联（RESUME/COMPLETE/REVALIDATE/BLOCKED/NEEDS_HUMAN）。
 */

/** status 事件允许的 phase 转移边表（fold 层的结构守卫；策略层决策见 reconciler.ts）。 */
export const STATUS_EDGES: Readonly<Record<Phase, readonly Phase[]>> = {
  SPEC_COMMITTED: ['EXECUTING', 'VERIFYING', 'BLOCKED', 'NEEDS_HUMAN'],
  EXECUTING: ['VERIFYING', 'BLOCKED', 'NEEDS_HUMAN'],
  VERIFYING: ['EXECUTING', 'REVALIDATING', 'BLOCKED', 'NEEDS_HUMAN'],
  REVALIDATING: ['COMPLETE', 'EXECUTING', 'BLOCKED', 'NEEDS_HUMAN'],
  COMPLETE: [],
  BLOCKED: ['EXECUTING'],
  NEEDS_HUMAN: ['EXECUTING'],
}

/** 允许提交新 spec 的状态：初始（无 spec）或上一 spec 已终态。 */
const SPEC_ENTRY_PHASES: readonly (Phase | null)[] = [null, 'COMPLETE', 'BLOCKED', 'NEEDS_HUMAN']

/** projection 允许出现的 phase（决策点与首轮 reconcile 时段）。 */
const PROJECTION_PHASES: readonly Phase[] = ['SPEC_COMMITTED', 'EXECUTING', 'VERIFYING']

/** commit 允许出现的 phase。 */
const COMMIT_PHASES: readonly Phase[] = ['SPEC_COMMITTED', 'EXECUTING', 'VERIFYING']

/** verdict 允许出现的 phase（含 REVALIDATING 全量重验）。 */
const VERDICT_PHASES: readonly Phase[] = ['EXECUTING', 'VERIFYING', 'REVALIDATING']

/** 全量重放：任一事件非法即抛 FoldError（停在坏事件处，state 丢弃）。 */
export function foldEvents(rawEvents: readonly unknown[]): GungnirState {
  let state = emptyState()
  for (let index = 0; index < rawEvents.length; index++) {
    state = foldEvent(state, rawEvents[index] as unknown, index)
  }
  return state
}

/** 增量 fold：单事件推进状态；非法即抛 FoldError。index 仅用于错误报告。 */
export function foldEvent(state: GungnirState, raw: unknown, index = 0): GungnirState {
  let event: GungnirEvent
  try {
    event = parseGungnirEvent(raw)
  } catch (error) {
    const rawType = typeof raw === 'object' && raw !== null && 'type' in raw
      ? String((raw as { type: unknown }).type)
      : null
    const detail = error instanceof Error ? error.message : String(error)
    throw new FoldError(index, rawType, 'schema', detail)
  }

  if (event.type === 'gungnir/loop-state' || event.type === 'gungnir/loop-transition') {
    throw new FoldError(index, event.type, 'reserved', 'event namespace reserved for stage 3 (ADR-0005); stage-1 fold must not consume it')
  }

  switch (event.type) {
    case 'gungnir/spec':
      return foldSpec(state, event, index)
    case 'gungnir/plan-projection':
      return foldProjection(state, event, index)
    case 'gungnir/commit':
      return foldCommit(state, event, index)
    case 'gungnir/evidence':
      return foldEvidence(state, event, index)
    case 'gungnir/claim':
      return foldClaim(state, event, index)
    case 'gungnir/verdict':
      return foldVerdict(state, event, index)
    case 'gungnir/status':
      return foldStatus(state, event, index)
  }
}

// ---- helpers ------------------------------------------------------------------

function requireSpec(state: GungnirState, index: number, eventType: string): void {
  if (state.spec === null || state.phase === null) {
    throw new FoldError(index, eventType, 'no-spec', 'no gungnir/spec committed yet')
  }
}

function requireSpecId(state: GungnirState, specId: string, index: number, eventType: string): void {
  if (state.spec!.specId !== specId) {
    throw new FoldError(
      index,
      eventType,
      'spec-mismatch',
      `event references spec "${specId}" but active spec is "${state.spec!.specId}"`,
    )
  }
}

function requirePhase(state: GungnirState, allowed: readonly Phase[], index: number, eventType: string): void {
  const phase = state.phase as Phase
  if (!allowed.includes(phase)) {
    throw new FoldError(index, eventType, 'phase', `event not allowed in phase ${phase}`)
  }
}

// ---- gungnir/spec -------------------------------------------------------------

function foldSpec(state: GungnirState, event: SpecEvent, index: number): GungnirState {
  if (state.spec !== null && !SPEC_ENTRY_PHASES.includes(state.phase)) {
    throw new FoldError(
      index,
      event.type,
      'spec-switch',
      `cannot commit a new spec while phase is ${state.phase} (allowed only from terminal states or fresh ledger)`,
    )
  }
  const criteria: GungnirState['criteria'] = {}
  for (const criterion of event.spec.successCriteria) {
    criteria[criterion.id] = {
      criterion,
      satisfied: false,
      lastOutcome: null,
      lastRawOutcome: null,
      lastVerdictRound: null,
      prevFailSignature: null,
      lastFailSignature: null,
      verdictCount: 0,
    }
  }
  return {
    ...state,
    spec: event.spec,
    phase: 'SPEC_COMMITTED',
    currentRound: 0,
    currentAction: null,
    projection: null,
    criteria,
    seenEvidenceIds: new Set<string>(),
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
    eventsFolded: state.eventsFolded + 1,
    lastEventTs: event.ts,
  }
}

// ---- gungnir/plan-projection --------------------------------------------------

function foldProjection(state: GungnirState, event: PlanProjectionEvent, index: number): GungnirState {
  requireSpec(state, index, event.type)
  requireSpecId(state, event.specId, index, event.type)
  requirePhase(state, PROJECTION_PHASES, index, event.type)
  const stepIds = new Set<string>()
  for (const step of event.steps) {
    if (stepIds.has(step.id)) {
      throw new FoldError(index, event.type, 'projection-steps', `duplicate projection step id "${step.id}"`)
    }
    stepIds.add(step.id)
    for (const criterionId of step.targetsCriteria) {
      if (!(criterionId in state.criteria)) {
        throw new FoldError(index, event.type, 'unknown-criterion', `projection step "${step.id}" targets unknown criterion "${criterionId}"`)
      }
    }
  }
  return { ...state, projection: event, eventsFolded: state.eventsFolded + 1, lastEventTs: event.ts }
}

// ---- gungnir/commit -----------------------------------------------------------

function foldCommit(state: GungnirState, event: CommitEvent, index: number): GungnirState {
  requireSpec(state, index, event.type)
  requireSpecId(state, event.specId, index, event.type)
  requirePhase(state, COMMIT_PHASES, index, event.type)
  if (event.round !== state.currentRound + 1) {
    throw new FoldError(
      index,
      event.type,
      'round-order',
      `commit round ${event.round} must be exactly currentRound+1 (current ${state.currentRound})`,
    )
  }
  for (const criterionId of event.targetsCriteria) {
    if (!(criterionId in state.criteria)) {
      throw new FoldError(index, event.type, 'unknown-criterion', `commit targets unknown criterion "${criterionId}"`)
    }
  }
  if (event.round > 1 && state.verdictsInCurrentRound === 0) {
    throw new FoldError(
      index,
      event.type,
      'unverified-round',
      `cannot start round ${event.round}: previous round ${state.currentRound} produced no verdict (no blind advancement)`,
    )
  }
  const retried = state.currentAction !== null && state.currentAction.actionId === event.actionId
    ? state.currentAction.retried + 1
    : 0
  const action = {
    round: event.round,
    actionId: event.actionId,
    summary: event.summary,
    targetsCriteria: event.targetsCriteria,
    expectedEvidence: event.expectedEvidence,
    projectionId: event.projectionId,
    stepId: event.stepId,
    retried,
  }
  return {
    ...state,
    phase: 'EXECUTING',
    currentRound: event.round,
    currentAction: action,
    verdictsInCurrentRound: 0,
    eventsFolded: state.eventsFolded + 1,
    lastEventTs: event.ts,
  }
}

// ---- gungnir/evidence ---------------------------------------------------------

function foldEvidence(state: GungnirState, event: EvidenceEvent, index: number): GungnirState {
  requireSpec(state, index, event.type)
  requireSpecId(state, event.specId, index, event.type)
  if (event.round > state.currentRound) {
    throw new FoldError(
      index,
      event.type,
      'round-order',
      `evidence round ${event.round} exceeds committed round ${state.currentRound} (no evidence from the future)`,
    )
  }
  if (state.seenEvidenceIds.has(event.evidenceId)) {
    throw new FoldError(index, event.type, 'duplicate-evidence', `evidenceId "${event.evidenceId}" already exists (ledger ids must be unique)`)
  }
  const seen = new Set(state.seenEvidenceIds)
  seen.add(event.evidenceId)
  return { ...state, seenEvidenceIds: seen, eventsFolded: state.eventsFolded + 1, lastEventTs: event.ts }
}

// ---- gungnir/claim ------------------------------------------------------------

function foldClaim(state: GungnirState, event: ClaimEvent, index: number): GungnirState {
  requireSpec(state, index, event.type)
  requireSpecId(state, event.specId, index, event.type)
  if (event.round < 1 || event.round > state.currentRound) {
    throw new FoldError(index, event.type, 'round-order', `claim round ${event.round} outside committed range (current ${state.currentRound})`)
  }
  // claim 是模型主张，不参与决策：只记录，不强校验 actionId 匹配（模型报错轮由 verdict 把关）
  return {
    ...state,
    lastClaim: event,
    claimsCount: state.claimsCount + 1,
    eventsFolded: state.eventsFolded + 1,
    lastEventTs: event.ts,
  }
}

// ---- gungnir/verdict ----------------------------------------------------------

function foldVerdict(state: GungnirState, event: VerdictEvent, index: number): GungnirState {
  requireSpec(state, index, event.type)
  requireSpecId(state, event.specId, index, event.type)
  requirePhase(state, VERDICT_PHASES, index, event.type)
  if (event.round < 1 || event.round > state.currentRound) {
    throw new FoldError(index, event.type, 'round-order', `verdict round ${event.round} outside committed range (current ${state.currentRound})`)
  }
  const criterionState = state.criteria[event.criterionId]
  if (criterionState === undefined) {
    throw new FoldError(index, event.type, 'unknown-criterion', `verdict for unknown criterion "${event.criterionId}"`)
  }
  const declared = criterionState.criterion
  if (event.verifier.kind !== declared.predicate.kind || event.verifier.level !== declared.verifierLevel) {
    throw new FoldError(
      index,
      event.type,
      'verifier-mismatch',
      `verifier {level:${event.verifier.level}, kind:"${event.verifier.kind}"} does not match criterion "${event.criterionId}" declaration {level:${declared.verifierLevel}, kind:"${declared.predicate.kind}"}`,
    )
  }
  if (event.outcome === 'FAIL' && event.errorSignature === '') {
    throw new FoldError(index, event.type, 'signature', 'FAIL verdict requires a non-empty errorSignature (transient determination input)')
  }

  const effective = effectiveOutcome(event.outcome, event.verifier.level)
  const criteria: GungnirState['criteria'] = { ...state.criteria }
  criteria[event.criterionId] = {
    ...criterionState,
    satisfied: effective === 'PASS',
    lastOutcome: effective,
    lastRawOutcome: event.outcome,
    lastVerdictRound: event.round,
    prevFailSignature: event.outcome === 'FAIL' ? criterionState.lastFailSignature : criterionState.prevFailSignature,
    lastFailSignature: event.outcome === 'FAIL' ? event.errorSignature : criterionState.lastFailSignature,
    verdictCount: criterionState.verdictCount + 1,
  }
  const next: GungnirState = {
    ...state,
    criteria,
    verdictRuns: state.verdictRuns + 1,
    verdictsInCurrentRound: state.verdictsInCurrentRound + 1,
    consecutiveInconclusive: event.outcome === 'INCONCLUSIVE' ? state.consecutiveInconclusive + 1 : 0,
    deterministicPassSeen: state.deterministicPassSeen || (event.outcome === 'PASS' && event.verifier.level <= 2),
    eventsFolded: state.eventsFolded + 1,
    lastEventTs: event.ts,
  }
  return { ...next, verifiedArtifacts: verifiedArtifactsOf(next) }
}

// ---- gungnir/status -----------------------------------------------------------

function foldStatus(state: GungnirState, event: StatusEvent, index: number): GungnirState {
  requireSpec(state, index, event.type)
  requireSpecId(state, event.specId, index, event.type)
  const currentPhase = state.phase as Phase
  const edges = STATUS_EDGES[currentPhase]
  if (!edges.includes(event.phase)) {
    throw new FoldError(index, event.type, 'phase-transition', `illegal phase transition ${currentPhase} → ${event.phase}`)
  }

  // 快照与派生值一致性（单一真理：status 是 fold 派生结果的投影，不是独立声明）
  const satisfied = satisfiedIdsOf(state)
  const derivedSatisfied = [...satisfied].sort()
  const declaredSatisfied = [...event.satisfiedCriteria].sort()
  if (derivedSatisfied.join(',') !== declaredSatisfied.join(',')) {
    throw new FoldError(
      index,
      event.type,
      'snapshot',
      `satisfiedCriteria ${JSON.stringify(declaredSatisfied)} does not match derived ${JSON.stringify(derivedSatisfied)}`,
    )
  }
  const total = state.spec!.successCriteria.length
  if (event.progressSnapshot.satisfied !== satisfied.length || event.progressSnapshot.total !== total) {
    throw new FoldError(
      index,
      event.type,
      'snapshot',
      `progressSnapshot {satisfied:${event.progressSnapshot.satisfied}, total:${event.progressSnapshot.total}} does not match derived {satisfied:${satisfied.length}, total:${total}}`,
    )
  }
  const derivedArtifacts = verifiedArtifactsOf(state)
  if (event.progressSnapshot.verifiedArtifacts !== derivedArtifacts) {
    throw new FoldError(index, event.type, 'snapshot', `progressSnapshot.verifiedArtifacts ${event.progressSnapshot.verifiedArtifacts} does not match derived ${derivedArtifacts}`)
  }

  // 决策字段与目标 phase 的强关联
  const decision = event.decision
  const resumeEntry = currentPhase === 'BLOCKED' || currentPhase === 'NEEDS_HUMAN'
  if (resumeEntry && decision !== 'RESUME') {
    throw new FoldError(index, event.type, 'decision', `leaving ${currentPhase} requires decision RESUME (got ${String(decision)})`)
  }
  if (event.phase === 'COMPLETE' && decision !== 'COMPLETE') {
    throw new FoldError(index, event.type, 'decision', 'entering COMPLETE requires decision COMPLETE')
  }
  if (event.phase === 'REVALIDATING' && decision !== 'REVALIDATE') {
    throw new FoldError(index, event.type, 'decision', 'entering REVALIDATING requires decision REVALIDATE')
  }
  if (event.phase === 'BLOCKED' && decision !== 'BLOCKED') {
    throw new FoldError(index, event.type, 'decision', 'entering BLOCKED requires decision BLOCKED')
  }
  if (event.phase === 'NEEDS_HUMAN' && decision !== 'NEEDS_HUMAN') {
    throw new FoldError(index, event.type, 'decision', 'entering NEEDS_HUMAN requires decision NEEDS_HUMAN')
  }

  // blocker 纪律
  if (event.phase === 'BLOCKED' && event.blocker === '') {
    throw new FoldError(index, event.type, 'blocker', 'entering BLOCKED requires a non-empty blocker code')
  }
  if (event.phase !== 'BLOCKED' && event.blocker !== '') {
    throw new FoldError(index, event.type, 'blocker', 'blocker must be empty outside BLOCKED phase')
  }

  // roundsNoImprovement：仅在离开 VERIFYING（轮末）时按 satisfied 峰值重算；
  // REVALIDATING 的进出不再重复计数（重验不产生新的 commit 轮）。
  const leavingRoundEnd = currentPhase === 'VERIFYING'
  let nextRni = state.roundsNoImprovement
  let nextMax = state.maxSatisfiedSeen
  if (leavingRoundEnd) {
    nextRni = satisfied.length > state.maxSatisfiedSeen ? 0 : state.roundsNoImprovement + 1
    nextMax = Math.max(state.maxSatisfiedSeen, satisfied.length)
    if (event.progressSnapshot.roundsNoImprovement !== nextRni) {
      throw new FoldError(
        index,
        event.type,
        'snapshot',
        `progressSnapshot.roundsNoImprovement ${event.progressSnapshot.roundsNoImprovement} does not match derived ${nextRni}`,
      )
    }
  } else if (event.progressSnapshot.roundsNoImprovement !== state.roundsNoImprovement) {
    throw new FoldError(index, event.type, 'snapshot', `progressSnapshot.roundsNoImprovement must stay ${state.roundsNoImprovement} outside round ends`)
  }

  return {
    ...state,
    phase: event.phase,
    roundsNoImprovement: nextRni,
    maxSatisfiedSeen: nextMax,
    blocker: event.blocker,
    eventsFolded: state.eventsFolded + 1,
    lastEventTs: event.ts,
  }
}
