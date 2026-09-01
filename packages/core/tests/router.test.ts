import { describe, expect, it } from 'vitest'
import { routeLoopMode, routerInputsOf, type LoopRouterInputs } from '../src/router.ts'
import { foldEvents, type GungnirState } from '../src/index.ts'
import { claimEvent, commitEvent, evidenceEvent, makeSpec, projectionEvent, specEvent, verdictEvent } from './fixtures.ts'

const inputs = (overrides: Partial<LoopRouterInputs> = {}): LoopRouterInputs => ({
  hasActiveSpec: false,
  hasCommittedAction: false,
  claimRecordedThisRound: false,
  machineVerifiableOutstanding: false,
  ...overrides,
})

describe('router v0: decision table (ordered, first match wins)', () => {
  it('R4 FAST: no goal work in flight (Default-to-cheap: native path, zero injection)', () => {
    expect(routeLoopMode(inputs())).toEqual({ mode: 'FAST', rule: 'fast-no-goal-work' })
    expect(routeLoopMode(inputs({ hasActiveSpec: false }))).toEqual({ mode: 'FAST', rule: 'fast-no-goal-work' })
  })

  it('R3 EXECUTE: active spec without a committed action (plan/continue work)', () => {
    expect(routeLoopMode(inputs({ hasActiveSpec: true }))).toEqual({ mode: 'EXECUTE', rule: 'execute-goal-work' })
  })

  it('R2 EXECUTE: committed action not yet claimed (execution round)', () => {
    expect(routeLoopMode(inputs({ hasActiveSpec: true, hasCommittedAction: true })))
      .toEqual({ mode: 'EXECUTE', rule: 'execute-action' })
  })

  it('R1 VERIFY: claimed action with outstanding machine-verifiable criteria', () => {
    expect(routeLoopMode(inputs({ hasActiveSpec: true, hasCommittedAction: true, claimRecordedThisRound: true, machineVerifiableOutstanding: true })))
      .toEqual({ mode: 'VERIFY', rule: 'verify-machine-verifiable' })
  })

  it('R1 does not fire without machine-verifiable outstanding (falls to R2 sibling guard -> R3)', () => {
    // claimed but nothing machine-verifiable left: VERIFY has nothing to check
    expect(routeLoopMode(inputs({ hasActiveSpec: true, hasCommittedAction: true, claimRecordedThisRound: true, machineVerifiableOutstanding: false })))
      .toEqual({ mode: 'EXECUTE', rule: 'execute-goal-work' })
  })

  it('R1 fires even when the spec sheet is otherwise complete (target-level, not spec-level)', () => {
    expect(routeLoopMode(inputs({ hasCommittedAction: true, claimRecordedThisRound: true, machineVerifiableOutstanding: true })))
      .toEqual({ mode: 'VERIFY', rule: 'verify-machine-verifiable' })
  })

  it('ordered priority: VERIFY beats EXECUTE when both could match', () => {
    const both = inputs({ hasActiveSpec: true, hasCommittedAction: true, claimRecordedThisRound: true, machineVerifiableOutstanding: true })
    expect(routeLoopMode(both).mode).toBe('VERIFY')
  })

  it('R0 escalation (P2): pending VERIFY upgrade wins over every normal route', () => {
    expect(routeLoopMode(inputs({ pendingEscalation: { mode: 'VERIFY' } }))).toEqual({ mode: 'VERIFY', rule: 'escalate-verify' })
    expect(routeLoopMode(inputs({ hasActiveSpec: true, hasCommittedAction: true, pendingEscalation: { mode: 'VERIFY' } }))).toEqual({ mode: 'VERIFY', rule: 'escalate-verify' })
  })

  it('R0 escalation (P2): pending RECOVER upgrade routes to RECOVER', () => {
    expect(routeLoopMode(inputs({ pendingEscalation: { mode: 'RECOVER' } }))).toEqual({ mode: 'RECOVER', rule: 'escalate-recover' })
  })

  it('R0 escalation: no pending escalation -> normal routing unchanged', () => {
    expect(routeLoopMode(inputs({ pendingEscalation: null }))).toEqual({ mode: 'FAST', rule: 'fast-no-goal-work' })
  })
})

describe('router v0: routerInputsOf derived from fold state', () => {
  it('fresh ledger: nothing active -> FAST inputs', () => {
    const state = foldEvents([])
    expect(routerInputsOf(state)).toEqual(inputs())
  })

  it('committed action, not claimed: R2 shape', () => {
    const spec = makeSpec()
    const state = foldEvents([
      specEvent(spec),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, actionId: 'a1', summary: 'do it', targets: ['c1'] }),
      evidenceEvent({ round: 1 }),
    ])
    // c1 是未满足的 L1 谓词 → machineVerifiableOutstanding 为 true；但 R2 只看 claim
    expect(routerInputsOf(state)).toEqual(inputs({ hasActiveSpec: true, hasCommittedAction: true, machineVerifiableOutstanding: true }))
  })

  it('claimed round with L2 target outstanding: R1 shape', () => {
    const spec = makeSpec()
    const state = foldEvents([
      specEvent(spec),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, actionId: 'a1', summary: 'do it', targets: ['c1'] }),
      evidenceEvent({ round: 1 }),
      claimEvent({ round: 1, actionId: 'a1' }),
    ])
    const derived = routerInputsOf(state)
    expect(derived.claimRecordedThisRound).toBe(true)
    expect(derived.machineVerifiableOutstanding).toBe(true)
    expect(routeLoopMode(derived).mode).toBe('VERIFY')
  })

  it('verified L2 target clears machineVerifiableOutstanding (no pointless VERIFY)', () => {
    const spec = makeSpec()
    const state = foldEvents([
      specEvent(spec),
      projectionEvent({ steps: [{ id: 's1', targets: ['c1'] }] }),
      commitEvent({ round: 1, actionId: 'a1', summary: 'do it', targets: ['c1'] }),
      evidenceEvent({ round: 1 }),
      claimEvent({ round: 1, actionId: 'a1' }),
      verdictEvent({ round: 1, criterionId: 'c1', outcome: 'PASS', level: 1, kind: 'exit_code' }),
    ])
    const derived = routerInputsOf(state)
    expect(derived.machineVerifiableOutstanding).toBe(false)
    expect(routeLoopMode(derived).mode).toBe('EXECUTE')
  })

  it('terminal spec (COMPLETE) is not active goal work', () => {
    const state: GungnirState = foldEvents([specEvent(makeSpec())])
    // force a terminal phase through the public fold surface is heavy; assert the derivation helper directly
    const inputsForTerminal = routerInputsOf({ ...state, phase: 'COMPLETE', currentAction: state.currentAction })
    expect(inputsForTerminal.hasActiveSpec).toBe(false)
  })
})
