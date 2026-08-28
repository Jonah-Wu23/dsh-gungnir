import { describe, expect, it } from 'vitest'
import { FoldError, foldEvent, foldEvents, type GungnirState } from '../src/index.ts'
import { commitEvent, evidenceEvent, makeSpec, projectionEvent, specEvent } from './fixtures.ts'

function loopTransition(options: {
  from: string | null
  to: string
  turn: number
  step: number
  rule?: string
  ts?: number
}) {
  return {
    type: 'gungnir/loop-transition',
    v: 1 as const,
    ts: options.ts ?? 1_700_000_000_000 + options.turn * 1000 + options.step,
    from: options.from,
    to: options.to,
    turn: options.turn,
    step: options.step,
    rule: options.rule ?? 'fast-no-goal-work',
  }
}

function loopState(options: {
  mode: string
  turn: number
  step: number
  transitionsCount: number
  ts?: number
}) {
  return {
    type: 'gungnir/loop-state',
    v: 1 as const,
    ts: options.ts ?? 1_700_000_000_000 + options.turn * 1000 + options.step + 1,
    mode: options.mode,
    turn: options.turn,
    step: options.step,
    transitionsCount: options.transitionsCount,
  }
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

describe('fold: loop events (stage-2, ADR-0005 namespace opened)', () => {
  it('cold-rebuilds a mode trajectory from transitions + state anchors', () => {
    const state = foldEvents([
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1, rule: 'fast-no-goal-work' }),
      loopState({ mode: 'FAST', turn: 1, step: 1, transitionsCount: 1 }),
      loopTransition({ from: 'FAST', to: 'EXECUTE', turn: 2, step: 1, rule: 'execute-goal-work' }),
      loopState({ mode: 'EXECUTE', turn: 2, step: 1, transitionsCount: 2 }),
      loopTransition({ from: 'EXECUTE', to: 'VERIFY', turn: 3, step: 2, rule: 'verify-machine-verifiable' }),
      loopState({ mode: 'VERIFY', turn: 3, step: 2, transitionsCount: 3 }),
    ])
    expect(state.loopMode).toBe('VERIFY')
    expect(state.loopTransitions).toHaveLength(3)
    expect(state.loopTransitions[0]).toMatchObject({ fromMode: null, mode: 'FAST', turn: 1, step: 1, rule: 'fast-no-goal-work' })
    expect(state.loopTransitions[2]).toMatchObject({ fromMode: 'EXECUTE', mode: 'VERIFY', turn: 3, step: 2, rule: 'verify-machine-verifiable' })
  })

  it('loop events fold without any spec (goal-less sessions have trajectories)', () => {
    const state = foldEvents([
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
    ])
    expect(state.loopMode).toBe('FAST')
    expect(state.spec).toBeNull()
    expect(state.phase).toBeNull()
  })

  it('loop events interleave with goal events in one stream', () => {
    const spec = makeSpec()
    const state = foldEvents([
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
      loopTransition({ from: 'FAST', to: 'EXECUTE', turn: 1, step: 2, rule: 'execute-goal-work' }),
      specEvent(spec),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, actionId: 'a1', summary: 'do it', targets: ['c1'] }),
      evidenceEvent({ round: 1 }),
      loopState({ mode: 'EXECUTE', turn: 2, step: 4, transitionsCount: 2 }),
    ])
    expect(state.loopMode).toBe('EXECUTE')
    expect(state.phase).toBe('EXECUTING')
    expect(state.currentRound).toBe(1)
  })

  it('rejects transition.from mismatching the derived current mode', () => {
    expectFoldError([
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
      loopTransition({ from: 'EXECUTE', to: 'VERIFY', turn: 1, step: 2 }),
    ], 'loop-transition', 'gungnir/loop-transition')
  })

  it('rejects no-op transitions (changes only)', () => {
    expectFoldError([
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
      loopTransition({ from: 'FAST', to: 'FAST', turn: 1, step: 2 }),
    ], 'loop-transition', 'gungnir/loop-transition')
  })

  it('rejects non-monotonic turn/step ordering', () => {
    expectFoldError([
      loopTransition({ from: null, to: 'FAST', turn: 5, step: 1 }),
      loopTransition({ from: 'FAST', to: 'EXECUTE', turn: 4, step: 9 }),
    ], 'loop-order', 'gungnir/loop-transition')
    expectFoldError([
      loopTransition({ from: null, to: 'FAST', turn: 5, step: 3 }),
      loopTransition({ from: 'FAST', to: 'EXECUTE', turn: 5, step: 2 }),
    ], 'loop-order', 'gungnir/loop-transition')
  })

  it('rejects loop-state anchors before any transition (orphan state)', () => {
    expectFoldError([
      loopState({ mode: 'FAST', turn: 1, step: 1, transitionsCount: 0 }),
    ], 'orphan-state', 'gungnir/loop-state')
  })

  it('rejects state snapshots disagreeing with derived mode or transition count', () => {
    expectFoldError([
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
      loopState({ mode: 'EXECUTE', turn: 1, step: 1, transitionsCount: 1 }),
    ], 'snapshot', 'gungnir/loop-state')
    expectFoldError([
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
      loopState({ mode: 'FAST', turn: 1, step: 1, transitionsCount: 7 }),
    ], 'snapshot', 'gungnir/loop-state')
  })

  it('D-11 prefix closure: every prefix of a mixed ledger folds cleanly (crash-consistency)', () => {
    const events: unknown[] = [
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
      specEvent(makeSpec()),
      loopTransition({ from: 'FAST', to: 'EXECUTE', turn: 1, step: 2, rule: 'execute-goal-work' }),
      commitEvent({ round: 1, actionId: 'a1', summary: 'do it', targets: ['c1'] }),
      evidenceEvent({ round: 1 }),
      loopState({ mode: 'EXECUTE', turn: 1, step: 5, transitionsCount: 2 }),
      loopTransition({ from: 'EXECUTE', to: 'VERIFY', turn: 2, step: 1, rule: 'verify-machine-verifiable' }),
    ]
    // 进程在任意事件边界被 kill：已落盘的前缀必须仍是合法账本（append-only 纪律）
    for (let cut = 0; cut <= events.length; cut++) {
      expect(() => foldEvents(events.slice(0, cut))).not.toThrow()
    }
  })

  it('incremental fold equals batch fold on a mixed ledger', () => {
    const events: unknown[] = [
      loopTransition({ from: null, to: 'FAST', turn: 1, step: 1 }),
      specEvent(makeSpec()),
      loopTransition({ from: 'FAST', to: 'EXECUTE', turn: 1, step: 2, rule: 'execute-goal-work' }),
      commitEvent({ round: 1, actionId: 'a1', summary: 'do it', targets: ['c1'] }),
      evidenceEvent({ round: 1 }),
      loopState({ mode: 'EXECUTE', turn: 1, step: 5, transitionsCount: 2 }),
    ]
    const batch = foldEvents(events)
    let incremental: GungnirState = foldEvents([])
    events.forEach((event, index) => {
      incremental = foldEvent(incremental, event, index)
    })
    expect(incremental.loopMode).toBe(batch.loopMode)
    expect(incremental.loopTransitions).toEqual(batch.loopTransitions)
    expect(incremental.eventsFolded).toBe(batch.eventsFolded)
  })
})
