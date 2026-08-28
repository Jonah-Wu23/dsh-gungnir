import { describe, expect, it } from 'vitest'
import {
  decisionToPhase,
  foldEvent,
  foldEvents,
  nextStepOf,
  reconcile,
  type Decision,
  type GungnirState,
  type VerdictEvent,
} from '../src/index.ts'
import {
  commitEvent,
  happyLedger,
  makeSpec,
  projectionEvent,
  specEvent,
  statusEvent,
  verdictEvent,
} from './fixtures.ts'

// reconciler 契约：插件先把 verdicts append 进 ledger 并 fold，再以同一批 verdict
// 事件调用 reconcile。所以这里统一：decide(ledger, verdicts) = fold(ledger+verdicts) 后决策。

type Ledger = unknown[]

interface VerifyingOptions {
  spec?: ReturnType<typeof makeSpec>
  steps?: Array<{ id: string; targets: string[] }>
  targets?: string[]
  round?: number
  actionId?: string
}

function verifyingLedger(options?: VerifyingOptions): Ledger {
  const spec = options?.spec ?? makeSpec()
  const targets = options?.targets ?? ['c1']
  const steps = options?.steps ?? [{ id: 's1', targets }]
  return [
    specEvent(spec),
    projectionEvent({ steps }),
    commitEvent({ round: options?.round ?? 1, targets, actionId: options?.actionId ?? 'a1', stepId: 's1' }),
    statusEvent({ phase: 'VERIFYING', satisfied: [], total: spec.successCriteria.length }),
  ]
}

function decide(ledger: Ledger, verdicts: VerdictEvent[]): Decision {
  return reconcile(foldEvents([...ledger, ...verdicts]), verdicts)
}

describe('reconcile: success path', () => {
  it('REVALIDATE when every criterion is satisfied at VERIFYING', () => {
    const spec = makeSpec()
    const verdicts = [
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' }),
      verdictEvent({ criterionId: 'c2', round: 1, kind: 'artifact', level: 2, outcome: 'PASS' }),
    ]
    expect(decide(verifyingLedger({ spec, steps: [{ id: 's1', targets: ['c1', 'c2'] }], targets: ['c1', 'c2'] }), verdicts).kind).toBe('REVALIDATE')
  })

  it('COMPLETE after full re-validation passes with L1/L2 corroboration', () => {
    const verdicts = [
      verdictEvent({ criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'PASS' }),
      verdictEvent({ criterionId: 'c2', round: 2, kind: 'artifact', level: 2, outcome: 'PASS' }),
    ]
    expect(decide(happyLedger().slice(0, 13), verdicts).kind).toBe('COMPLETE')
  })
})

describe('reconcile: circuit breakers', () => {
  it('BLOCKED when budget.maxRounds is spent', () => {
    const spec = makeSpec({ maxRounds: 1 })
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig' })]
    const decision = decide(verifyingLedger({ spec }), verdicts)
    expect(decision.kind).toBe('BLOCKED')
    expect(decision.blocker).toBe('budget-exhausted')
  })

  it('BLOCKED when budget.maxVerifierRuns is spent', () => {
    const spec = makeSpec({ maxVerifierRuns: 1 })
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig' })]
    const decision = decide(verifyingLedger({ spec }), verdicts)
    expect(decision.kind).toBe('BLOCKED')
    expect(decision.blocker).toBe('verifier-budget-exhausted')
  })

  it('BLOCKED after three consecutive rounds without satisfaction growth', () => {
    const spec = makeSpec()
    let state: GungnirState = foldEvents([specEvent(spec), projectionEvent({})])
    let rni = 0
    for (const round of [1, 2, 3, 4]) {
      state = foldEvent(state, commitEvent({ round, actionId: 'a1', targets: ['c1'] }))
      state = foldEvent(state, statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: rni }))
      state = foldEvent(state, verdictEvent({ criterionId: 'c1', round, kind: 'exit_code', level: 1, outcome: 'PARTIAL' }))
      if (round < 4) {
        rni += 1
        state = foldEvent(state, statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: rni, decision: 'RETRY' }))
      }
    }
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 4, kind: 'exit_code', level: 1, outcome: 'PARTIAL' })]
    const decision = reconcile(state, verdicts)
    expect(decision.kind).toBe('BLOCKED')
    expect(decision.blocker).toBe('no-progress')
  })

  it('NEEDS_HUMAN after three consecutive INCONCLUSIVE verdicts', () => {
    const verdicts = [1, 2, 3].map(() =>
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'INCONCLUSIVE' as const }),
    )
    expect(decide(verifyingLedger(), verdicts).kind).toBe('NEEDS_HUMAN')
  })
})

describe('reconcile: human gates', () => {
  it('NEEDS_HUMAN when a verifier escalates', () => {
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'NEEDS_HUMAN' })]
    expect(decide(verifyingLedger(), verdicts).kind).toBe('NEEDS_HUMAN')
  })

  it('NEEDS_HUMAN when the committed action targets a human predicate', () => {
    const spec = makeSpec({ criteria: [{ id: 'c4', kind: 'human' }] })
    expect(reconcile(foldEvents(verifyingLedger({ spec, steps: [{ id: 's1', targets: ['c4'] }], targets: ['c4'] })), []).kind).toBe('NEEDS_HUMAN')
  })

  it('NEEDS_HUMAN when only an untargeted human criterion blocks completion', () => {
    const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }, { id: 'c4', kind: 'human' }] })
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' })]
    expect(decide(verifyingLedger({ spec }), verdicts).kind).toBe('NEEDS_HUMAN')
  })
})

describe('reconcile: replan triggers', () => {
  it('REPLAN on STALE verdict (environment drift)', () => {
    const spec = makeSpec({ criteria: [{ id: 'c2', kind: 'artifact' }] })
    const verdicts = [verdictEvent({ criterionId: 'c2', round: 1, kind: 'artifact', level: 2, outcome: 'STALE' })]
    expect(decide(verifyingLedger({ spec, targets: ['c2'] }), verdicts).kind).toBe('REPLAN')
  })

  it('REPLAN when re-validation finds a regression', () => {
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'regression' })]
    expect(decide(happyLedger().slice(0, 13), verdicts).kind).toBe('REPLAN')
  })

  it('REPLAN when targets pass but the projection is exhausted (machine criteria remain)', () => {
    const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }, { id: 'c2', kind: 'artifact' }] })
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' })]
    expect(decide(verifyingLedger({ spec }), verdicts).kind).toBe('REPLAN')
  })

  it('REPLAN on first-time failure (no prior signature)', () => {
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' })]
    expect(decide(verifyingLedger(), verdicts).kind).toBe('REPLAN')
  })
})

describe('reconcile: advance & retry paths', () => {
  it('ADVANCE with the next projection step when targets pass', () => {
    const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }, { id: 'c2', kind: 'artifact' }] })
    const ledger = [
      specEvent(spec),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }, { id: 's2', targets: ['c2'] }] }),
      commitEvent({ round: 1, targets: ['c1'], stepId: 's1' }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 }),
    ]
    const verdicts = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' })]
    const decision = decide(ledger, verdicts)
    expect(decision.kind).toBe('ADVANCE')
    expect(decision.nextStep?.id).toBe('s2')
  })

  it('RETRY when the same failure signature repeats and retries remain', () => {
    const round1 = verifyingLedger()
    const v1 = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' })]
    // 第一轮：REPLAN → 回 EXECUTING → 同 action 重新提交
    expect(decide(round1, v1).kind).toBe('REPLAN')
    let state = foldEvents([...round1, ...v1])
    state = foldEvent(state, statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 1, decision: 'REPLAN' }))
    state = foldEvent(state, commitEvent({ round: 2, actionId: 'a1', targets: ['c1'] }))
    state = foldEvent(state, statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 1 }))
    const v2 = [verdictEvent({ criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' })]
    const decision = reconcile(foldEvents2(state, v2), v2)
    expect(decision.kind).toBe('RETRY')
    expect(decision.retryActionId).toBe('a1')
  })

  it('BLOCKED stuck when retries are exhausted on the same signature', () => {
    // r1 FAIL sigA → REPLAN；r2 FAIL sigA → RETRY；r3 FAIL sigA → BLOCKED stuck
    let state = foldEvents([
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' }),
      statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 1, decision: 'REPLAN' }),
      commitEvent({ round: 2, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 1 }),
      verdictEvent({ criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' }),
      statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 2, decision: 'RETRY' }),
      commitEvent({ round: 3, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 2 }),
    ])
    const v3 = [verdictEvent({ criterionId: 'c1', round: 3, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' })]
    state = foldEvents2(state, v3)
    const decision = reconcile(state, v3)
    expect(decision.kind).toBe('BLOCKED')
    expect(decision.blocker).toBe('stuck')
  })

  it('RETRY then NEEDS_HUMAN for repeated INCONCLUSIVE within retry limits', () => {
    // r1 INCONCLUSIVE（consec=1）→ RETRY
    const v1 = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'INCONCLUSIVE' })]
    expect(decide(verifyingLedger(), v1).kind).toBe('RETRY')

    // r3 INCONCLUSIVE（retried 已到 2，consec 仅 1）→ NEEDS_HUMAN
    let state = foldEvents([
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'INCONCLUSIVE' }),
      statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 1, decision: 'RETRY' }),
      commitEvent({ round: 2, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 1 }),
      verdictEvent({ criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' }),
      statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 2, decision: 'REPLAN' }),
      commitEvent({ round: 3, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 2 }),
    ])
    const v3 = [verdictEvent({ criterionId: 'c1', round: 3, kind: 'exit_code', level: 1, outcome: 'INCONCLUSIVE' })]
    state = foldEvents2(state, v3)
    expect(reconcile(state, v3).kind).toBe('NEEDS_HUMAN')
  })

  it('RETRY then BLOCKED verifier-unresolved for persistent PARTIAL', () => {
    const v1 = [verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PARTIAL' })]
    expect(decide(verifyingLedger(), v1).kind).toBe('RETRY')

    let state = foldEvents([
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PARTIAL' }),
      statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 1, decision: 'RETRY' }),
      commitEvent({ round: 2, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 1 }),
      verdictEvent({ criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'PARTIAL' }),
      statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 2, decision: 'RETRY' }),
      commitEvent({ round: 3, actionId: 'a1', targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 2 }),
    ])
    const v3 = [verdictEvent({ criterionId: 'c1', round: 3, kind: 'exit_code', level: 1, outcome: 'PARTIAL' })]
    state = foldEvents2(state, v3)
    const decision = reconcile(state, v3)
    expect(decision.kind).toBe('BLOCKED')
    expect(decision.blocker).toBe('verifier-unresolved')
  })
})

describe('reconcile: preconditions & helpers', () => {
  it('throws outside decision points / without spec / without action', () => {
    expect(() => reconcile(foldEvents([]), [])).toThrow(/no spec|reconcile requires/)
    const specOnly = foldEvents([specEvent(makeSpec())])
    expect(() => reconcile(specOnly, [])).toThrow(/decision points/)
    const committed = foldEvents([specEvent(makeSpec()), projectionEvent({}), commitEvent({ round: 1 })])
    expect(() => reconcile(committed, [])).toThrow(/decision points/)
  })

  it('nextStepOf handles missing projection / action / step boundaries', () => {
    expect(nextStepOf(foldEvents([]))).toBeNull()
    expect(nextStepOf(foldEvents([specEvent(makeSpec())]))).toBeNull()
    const state = foldEvents([
      specEvent(makeSpec()),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }, { id: 's2', targets: ['c2'] }] }),
      commitEvent({ round: 1, stepId: 's2', targets: ['c2'] }),
    ])
    expect(nextStepOf(state)).toBeNull() // s2 已是最后一步
    expect(state.currentAction?.stepId).toBe('s2')
  })

  it('maps decisions to phases', () => {
    expect(decisionToPhase('ADVANCE')).toBe('EXECUTING')
    expect(decisionToPhase('REPLAN')).toBe('EXECUTING')
    expect(decisionToPhase('RETRY')).toBe('EXECUTING')
    expect(decisionToPhase('BLOCKED')).toBe('BLOCKED')
    expect(decisionToPhase('NEEDS_HUMAN')).toBe('NEEDS_HUMAN')
    expect(decisionToPhase('REVALIDATE')).toBe('REVALIDATING')
    expect(decisionToPhase('COMPLETE')).toBe('COMPLETE')
  })
})

// ---- helpers -------------------------------------------------------------------

/** 在既有状态上折叠新事件（保持不可变风格的小包装）。 */
function foldEvents2(state: GungnirState, events: unknown[]): GungnirState {
  let next = state
  for (const event of events) next = foldEvent(next, event)
  return next
}

