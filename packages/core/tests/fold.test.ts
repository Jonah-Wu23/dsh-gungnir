import { describe, expect, it } from 'vitest'
import {
  FoldError,
  foldEvent,
  foldEvents,
  type GungnirState,
} from '../src/index.ts'
import {
  claimEvent,
  commitEvent,
  evidenceEvent,
  happyLedger,
  makeSpec,
  projectionEvent,
  specEvent,
  statusEvent,
  verdictEvent,
} from './fixtures.ts'

function foldOrThrow(events: unknown[]): GungnirState {
  return foldEvents(events)
}

function expectFoldError(events: unknown[], code: string, type?: string): FoldError {
  try {
    foldEvents(events)
  } catch (error) {
    expect(error).toBeInstanceOf(FoldError)
    const foldError = error as FoldError
    expect(foldError.code).toBe(code)
    if (type !== undefined) expect(foldError.eventType).toBe(type)
    return foldError
  }
  throw new Error(`expected FoldError with code "${code}", but fold succeeded`)
}

describe('fold: happy path', () => {
  it('replays the canonical two-round lifecycle to COMPLETE', () => {
    const state = foldOrThrow(happyLedger())
    expect(state.phase).toBe('COMPLETE')
    expect(state.currentRound).toBe(2)
    expect(state.criteria['c1']?.satisfied).toBe(true)
    expect(state.criteria['c2']?.satisfied).toBe(true)
    expect(state.criteria['c1']?.verdictCount).toBe(2)
    expect(state.verdictRuns).toBe(4)
    expect(state.verifiedArtifacts).toBe(1)
    expect(state.deterministicPassSeen).toBe(true)
    expect(state.roundsNoImprovement).toBe(0)
    expect(state.maxSatisfiedSeen).toBe(2)
    expect(state.claimsCount).toBe(1)
    expect(state.currentAction?.retried).toBe(0)
    expect(state.eventsFolded).toBe(16)
  })

  it('incremental fold equals batch fold', () => {
    const ledger = happyLedger()
    let incremental = foldEvents([])
    ledger.forEach((event, index) => {
      incremental = foldEvent(incremental, event, index)
    })
    expect(incremental).toEqual(foldOrThrow(ledger))
    expect(incremental.seenEvidenceIds).toEqual(foldOrThrow(ledger).seenEvidenceIds)
  })

  it('starts a fresh spec after a terminal phase, resetting per-spec bookkeeping', () => {
    const finished = foldOrThrow(happyLedger())
    const secondSpec = makeSpec({ specId: 'spec-2' })
    const state = foldEvent(finished, specEvent(secondSpec))
    expect(state.phase).toBe('SPEC_COMMITTED')
    expect(state.spec?.specId).toBe('spec-2')
    expect(state.currentRound).toBe(0)
    expect(state.verdictRuns).toBe(0)
    expect(state.claimsCount).toBe(0)
    expect(state.verifiedArtifacts).toBe(0)
    expect(state.seenEvidenceIds.size).toBe(0)
  })
})

describe('fold: gungnir/spec guards', () => {
  it('rejects a new spec mid-run (EXECUTING)', () => {
    const events = happyLedger().slice(0, 3) // spec, projection, commit r1
    events.push(specEvent(makeSpec({ specId: 'spec-2' })))
    const error = expectFoldError(events, 'spec-switch', 'gungnir/spec')
    expect(error.eventIndex).toBe(3)
  })

  it('rejects a new spec while VERIFYING or REVALIDATING', () => {
    for (const cut of [7, 13]) {
      const events = happyLedger().slice(0, cut)
      events.push(specEvent(makeSpec({ specId: 'spec-2' })))
      expectFoldError(events, 'spec-switch')
    }
  })

  it('accepts a new spec after BLOCKED', () => {
    const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }] })
    const events: unknown[] = [
      specEvent(spec),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 1 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig' }),
      statusEvent({ phase: 'BLOCKED', satisfied: [], total: 1, roundsNoImprovement: 1, blocker: 'stuck', decision: 'BLOCKED' }),
      specEvent(makeSpec({ specId: 'spec-2', criteria: [{ id: 'c9', kind: 'exit_code' }] })),
    ]
    const state = foldOrThrow(events)
    expect(state.phase).toBe('SPEC_COMMITTED')
    expect(state.spec?.specId).toBe('spec-2')
  })
})

describe('fold: projection guards', () => {
  it('rejects projection with wrong specId', () => {
    const events: unknown[] = [specEvent(makeSpec()), projectionEvent({ specId: 'other' })]
    expectFoldError(events, 'spec-mismatch', 'gungnir/plan-projection')
  })

  it('rejects projection with duplicate step ids', () => {
    const events: unknown[] = [
      specEvent(makeSpec()),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }, { id: 's1', targets: ['c2'] }] }),
    ]
    expectFoldError(events, 'projection-steps')
  })

  it('rejects projection steps targeting unknown criteria', () => {
    const events: unknown[] = [
      specEvent(makeSpec()),
      projectionEvent({ steps: [{ id: 's1', targets: ['ghost'] }] }),
    ]
    expectFoldError(events, 'unknown-criterion')
  })

  it('rejects projection during REVALIDATING', () => {
    const events = happyLedger().slice(0, 13) // ... status REVALIDATING
    events.push(projectionEvent({ steps: [{ id: 'sx', targets: ['c1'] }] }))
    expectFoldError(events, 'phase')
  })

  it('accepts an initial projection before the first commit', () => {
    const events: unknown[] = [specEvent(makeSpec()), projectionEvent({})]
    const state = foldOrThrow(events)
    expect(state.projection?.projectionId).toBe('proj-1')
  })
})

describe('fold: commit guards', () => {
  it('rejects commit without a spec', () => {
    expectFoldError([commitEvent({ round: 1 })], 'no-spec', 'gungnir/commit')
  })

  it('rejects skipped or repeated rounds', () => {
    const base: unknown[] = [
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1 }),
    ]
    expectFoldError([...base, commitEvent({ round: 3 })], 'round-order')
    expectFoldError([...base, commitEvent({ round: 1 })], 'round-order')
  })

  it('rejects commits targeting unknown criteria', () => {
    const events: unknown[] = [
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1, targets: ['ghost'] }),
    ]
    expectFoldError(events, 'unknown-criterion')
  })

  it('rejects a new round when the previous round produced no verdict', () => {
    const events: unknown[] = [
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1 }),
      commitEvent({ round: 2 }),
    ]
    const error = expectFoldError(events, 'unverified-round')
    expect(error.eventIndex).toBe(3)
  })

  it('tracks retried count when the same actionId is recommitted', () => {
    const events: unknown[] = [
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1, actionId: 'a1' }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' }),
      statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2, roundsNoImprovement: 1, decision: 'REPLAN' }),
      commitEvent({ round: 2, actionId: 'a1' }),
    ]
    const state = foldOrThrow(events)
    expect(state.currentAction?.retried).toBe(1)
    expect(state.currentRound).toBe(2)
  })
})

describe('fold: evidence guards', () => {
  function committedLedger(): unknown[] {
    return [specEvent(makeSpec()), projectionEvent({}), commitEvent({ round: 1 })]
  }

  it('rejects evidence from the future', () => {
    const events = committedLedger()
    events.push({ ...evidenceEvent({ round: 2 }), ts: 1 })
    expectFoldError(events, 'round-order', 'gungnir/evidence')
  })

  it('rejects duplicate evidenceIds', () => {
    const events = committedLedger()
    events.push(evidenceEvent({ round: 1, evidenceId: 'ev-x' }))
    events.push(evidenceEvent({ round: 1, evidenceId: 'ev-x' }))
    expectFoldError(events, 'duplicate-evidence')
  })

  it('accepts round-0 baseline evidence before the first commit', () => {
    const events: unknown[] = [specEvent(makeSpec()), evidenceEvent({ round: 0, evidenceId: 'ev-base' })]
    const state = foldOrThrow(events)
    expect(state.seenEvidenceIds.has('ev-base')).toBe(true)
  })

  it('rejects evidence without a spec', () => {
    expectFoldError([evidenceEvent({ round: 0 })], 'no-spec', 'gungnir/evidence')
  })
})

describe('fold: claim guards', () => {
  it('rejects claims outside the committed round range', () => {
    const base: unknown[] = [specEvent(makeSpec()), projectionEvent({}), commitEvent({ round: 1 })]
    // round 0 违反 schema 层 positive 约束 → schema 错误；round 2 超前 → fold 的 round-order
    expectFoldError([...base, claimEvent({ round: 0 })], 'schema', 'gungnir/claim')
    expectFoldError([...base, claimEvent({ round: 2 })], 'round-order')
  })

  it('records claims as advisory state without verdict authority', () => {
    const events: unknown[] = [
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1 }),
      claimEvent({ round: 1, assertedOutcome: 'done' }),
    ]
    const state = foldOrThrow(events)
    expect(state.claimsCount).toBe(1)
    expect(state.lastClaim?.assertedOutcome).toBe('done')
    expect(state.criteria['c1']?.satisfied).toBe(false)
  })
})

describe('fold: verdict guards', () => {
  function verifyingLedger(): unknown[] {
    return [
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1 }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 }),
    ]
  }

  it('rejects verdicts for unknown criteria', () => {
    const events = verifyingLedger()
    events.push(verdictEvent({ criterionId: 'ghost', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' }))
    expectFoldError(events, 'unknown-criterion', 'gungnir/verdict')
  })

  it('rejects verifier kind mismatch', () => {
    const events = verifyingLedger()
    events.push(verdictEvent({ criterionId: 'c1', round: 1, kind: 'artifact', level: 1, outcome: 'PASS' }))
    expectFoldError(events, 'verifier-mismatch')
  })

  it('rejects verifier level mismatch', () => {
    const events = verifyingLedger()
    events.push(verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 2, outcome: 'PASS' }))
    expectFoldError(events, 'verifier-mismatch')
  })

  it('rejects FAIL verdict with empty errorSignature', () => {
    const events = verifyingLedger()
    events.push(verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL' }))
    expectFoldError(events, 'signature')
  })

  it('rejects verdicts before the first commit and from future rounds', () => {
    const early: unknown[] = [specEvent(makeSpec()), verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' })]
    expectFoldError(early, 'phase')
    const future: unknown[] = [...verifyingLedger(), verdictEvent({ criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'PASS' })]
    expectFoldError(future, 'round-order')
  })

  it('downgrades L4 PASS to PARTIAL (ladder rule: no final PASS from semantics alone)', () => {
    const spec = makeSpec({ criteria: [{ id: 'c3', kind: 'llm_rubric' }] })
    const events: unknown[] = [
      specEvent(spec),
      projectionEvent({ specId: 'spec-1', steps: [{ id: 's1', targets: ['c3'] }] }),
      commitEvent({ round: 1, targets: ['c3'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 1 }),
      verdictEvent({ criterionId: 'c3', round: 1, kind: 'llm_rubric', level: 4, outcome: 'PASS' }),
    ]
    const state = foldOrThrow(events)
    const criterion = state.criteria['c3']
    expect(criterion?.satisfied).toBe(false)
    expect(criterion?.lastRawOutcome).toBe('PASS')
    expect(criterion?.lastOutcome).toBe('PARTIAL')
    expect(state.deterministicPassSeen).toBe(false)
  })

  it('tracks consecutive INCONCLUSIVE and fail signatures', () => {
    const events = verifyingLedger()
    events.push(verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' }))
    let state = foldOrThrow(events)
    expect(state.consecutiveInconclusive).toBe(0)
    expect(state.criteria['c1']?.lastFailSignature).toBe('sig-a')
    expect(state.criteria['c1']?.prevFailSignature).toBeNull()

    state = foldEvent(state, { ...verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'INCONCLUSIVE' }), ts: 99 })
    expect(state.consecutiveInconclusive).toBe(1)
    expect(state.criteria['c1']?.lastFailSignature).toBe('sig-a')

    state = foldEvent(state, { ...verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'INCONCLUSIVE' }), ts: 100 })
    expect(state.consecutiveInconclusive).toBe(2)
    state = foldEvent(state, { ...verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-b' }), ts: 101 })
    expect(state.consecutiveInconclusive).toBe(0)
    expect(state.criteria['c1']?.prevFailSignature).toBe('sig-a')
    expect(state.criteria['c1']?.lastFailSignature).toBe('sig-b')
  })
})

describe('fold: status guards', () => {
  function verifyingLedger(): unknown[] {
    return [
      specEvent(makeSpec()),
      projectionEvent({}),
      commitEvent({ round: 1 }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 }),
    ]
  }

  it('rejects skipping REVALIDATION on the way to COMPLETE', () => {
    const events = verifyingLedger()
    events.push(statusEvent({ phase: 'COMPLETE', satisfied: ['c1', 'c2'], total: 2, decision: 'COMPLETE' }))
    expectFoldError(events, 'phase-transition', 'gungnir/status')
  })

  it('rejects any transition out of COMPLETE', () => {
    const events = happyLedger()
    events.push(statusEvent({ phase: 'EXECUTING', satisfied: ['c1', 'c2'], total: 2, verifiedArtifacts: 1, decision: 'RESUME' }))
    expectFoldError(events, 'phase-transition')
  })

  it('rejects self-transition and unknown edges', () => {
    const base: unknown[] = [specEvent(makeSpec()), projectionEvent({}), commitEvent({ round: 1 })]
    expectFoldError([...base, statusEvent({ phase: 'EXECUTING', satisfied: [], total: 2 })], 'phase-transition')
    expectFoldError([specEvent(makeSpec()), statusEvent({ phase: 'REVALIDATING', satisfied: [], total: 2, decision: 'REVALIDATE' })], 'phase-transition')
  })

  it('allows SPEC_COMMITTED → VERIFYING (deferred first round)', () => {
    const events: unknown[] = [specEvent(makeSpec()), statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2 })]
    const state = foldOrThrow(events)
    expect(state.phase).toBe('VERIFYING')
  })

  it('requires decision RESUME when leaving BLOCKED / NEEDS_HUMAN', () => {
    const blocked: unknown[] = [
      specEvent(makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }] })),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 1 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig' }),
      statusEvent({ phase: 'BLOCKED', satisfied: [], total: 1, roundsNoImprovement: 1, blocker: 'stuck', decision: 'BLOCKED' }),
    ]
    const events = [...blocked, statusEvent({ phase: 'EXECUTING', satisfied: [], total: 1 })]
    expectFoldError(events, 'decision')

    const human: unknown[] = [
      specEvent(makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }] })),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 1 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig' }),
      statusEvent({ phase: 'NEEDS_HUMAN', satisfied: [], total: 1, roundsNoImprovement: 1, decision: 'NEEDS_HUMAN' }),
    ]
    expectFoldError([...human, statusEvent({ phase: 'EXECUTING', satisfied: [], total: 1 })], 'decision')
  })

  it('requires the matching decision when entering COMPLETE / REVALIDATING / NEEDS_HUMAN', () => {
    const events = happyLedger().slice(0, 15) // …REVALIDATING + 两条重验 verdict
    events.push(statusEvent({ phase: 'COMPLETE', satisfied: ['c1', 'c2'], total: 2, verifiedArtifacts: 1 }))
    expectFoldError(events, 'decision')

    const reval: unknown[] = [
      specEvent(makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }] })),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, targets: ['c1'] }),
      statusEvent({ phase: 'VERIFYING', satisfied: [], total: 1 }),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' }),
      statusEvent({ phase: 'REVALIDATING', satisfied: ['c1'], total: 1 }),
    ]
    expectFoldError(reval, 'decision')

    expectFoldError(
      [...verifyingLedger(), statusEvent({ phase: 'NEEDS_HUMAN', satisfied: [], total: 2 })],
      'decision',
    )
  })

  it('enforces blocker discipline', () => {
    const committed: unknown[] = [specEvent(makeSpec()), projectionEvent({}), commitEvent({ round: 1 })]
    const events = [...committed, statusEvent({ phase: 'BLOCKED', satisfied: [], total: 2, decision: 'BLOCKED' })]
    expectFoldError(events, 'blocker')

    const stray = [...committed, statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, blocker: 'ghost' })]
    expectFoldError(stray, 'blocker')
  })

  it('rejects snapshots that disagree with fold-derived truth', () => {
    const wrongList = verifyingLedger()
    wrongList.push(statusEvent({ phase: 'EXECUTING', satisfied: ['c2'], total: 2, decision: 'ADVANCE' }))
    expectFoldError(wrongList, 'snapshot')

    const wrongCount = verifyingLedger()
    wrongCount.push(statusEvent({ phase: 'EXECUTING', satisfied: [], total: 3, decision: 'ADVANCE' }))
    expectFoldError(wrongCount, 'snapshot')

    const wrongArtifacts = verifyingLedger()
    wrongArtifacts.push(verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' }))
    wrongArtifacts.push(statusEvent({ phase: 'EXECUTING', satisfied: ['c1'], total: 2, verifiedArtifacts: 3, decision: 'ADVANCE' }))
    expectFoldError(wrongArtifacts, 'snapshot')

    const wrongRni = verifyingLedger()
    wrongRni.push(verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' }))
    wrongRni.push(statusEvent({ phase: 'EXECUTING', satisfied: ['c1'], total: 2, roundsNoImprovement: 5, decision: 'ADVANCE' }))
    expectFoldError(wrongRni, 'snapshot')

    const rniOutside: unknown[] = [specEvent(makeSpec()), projectionEvent({}), commitEvent({ round: 1 }), statusEvent({ phase: 'VERIFYING', satisfied: [], total: 2, roundsNoImprovement: 1 })]
    expectFoldError(rniOutside, 'snapshot')
  })

  it('rejects orphan loop-state anchors and unknown schemas loudly (stage-2: loop events fold)', () => {
    const events: unknown[] = [specEvent(makeSpec()), { type: 'gungnir/loop-state', v: 1, ts: 1, mode: 'FAST', turn: 1, step: 1, transitionsCount: 0 }]
    expectFoldError(events, 'orphan-state', 'gungnir/loop-state')
    expectFoldError([{ type: 'gungnir/unknown', v: 1, ts: 1 }], 'schema')
    expectFoldError([{ type: 'gungnir/spec', v: 1, ts: 1, spec: { nope: true } }], 'schema', 'gungnir/spec')
  })

  it('does not mutate the previous state (purity)', () => {
    const before = foldEvents([specEvent(makeSpec())])
    const snapshot = structuredClone(before)
    foldEvent(before, projectionEvent({}))
    expect(before).toEqual(snapshot)
  })
})
