import { describe, expect, it } from 'vitest'
import {
  GoalSpecSchema,
  GungnirEventSchema,
  firstSpecOf,
  makeEvent,
  parseGungnirEvent,
  sha256Of,
  type GoalSpec,
} from '../src/index.ts'
import { evidenceEvent, makeSpec, specEvent, ts, verdictEvent } from './fixtures.ts'

describe('GoalSpec schema', () => {
  it('accepts a well-formed spec', () => {
    const spec = makeSpec()
    expect(GoalSpecSchema.parse(spec).objective).toBe('make the thing true')
  })

  it('rejects verifierLevel inconsistent with predicate kind', () => {
    const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }] })
    const broken: GoalSpec = {
      ...spec,
      successCriteria: [{ ...spec.successCriteria[0]!, verifierLevel: 2 }],
    }
    expect(() => GoalSpecSchema.parse(broken)).toThrow(/does not match predicate kind/)
  })

  it('rejects duplicate criterion ids', () => {
    const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }, { id: 'c1', kind: 'artifact' }] })
    expect(() => GoalSpecSchema.parse(spec)).toThrow(/duplicate success criterion id/)
  })

  it('rejects empty successCriteria', () => {
    const spec = makeSpec({ criteria: [] })
    expect(() => GoalSpecSchema.parse(spec)).toThrow()
  })

  it('rejects malformed sha256 in artifact predicate', () => {
    const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'artifact' }] })
    const broken = structuredClone(spec)
    const predicate = broken.successCriteria[0]!.predicate
    if (predicate.kind === 'artifact') predicate.sha256 = 'nothex'
    expect(() => GoalSpecSchema.parse(broken)).toThrow()
  })

  it('applies defaults (constraints/budget/timeouts)', () => {
    const raw = {
      specId: 's',
      version: 1,
      objective: 'o',
      successCriteria: [
        {
          id: 'c1',
          description: 'd',
          predicate: { kind: 'exit_code', command: 'x' },
          verifierLevel: 1,
        },
      ],
    }
    const parsed = GoalSpecSchema.parse(raw)
    expect(parsed.constraints).toEqual([])
    expect(parsed.budget).toEqual({ maxRounds: null, maxVerifierRuns: null })
    const predicate = parsed.successCriteria[0]!.predicate
    if (predicate.kind === 'exit_code') {
      expect(predicate.expectedExitCode).toBe(0)
      expect(predicate.timeoutMs).toBe(60_000)
    } else {
      expect.unreachable('predicate kind should stay exit_code')
    }
  })
})

describe('event schemas', () => {
  it('round-trips every event through parseGungnirEvent', () => {
    const spec = makeSpec()
    const events = [
      specEvent(spec),
      verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL', errorSignature: 'sig-a' }),
    ]
    for (const event of events) {
      expect(parseGungnirEvent(event)).toEqual(event)
    }
  })

  it('rejects unknown event types', () => {
    expect(() => GungnirEventSchema.parse({ type: 'gungnir/unknown', v: 1, ts: 1 })).toThrow()
  })

  it('defaults FAIL verdict errorSignature to empty string (fold rejects the empty signature)', () => {
    const event = verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'FAIL' })
    const { errorSignature: _omitted, ...rest } = event
    const parsed = GungnirEventSchema.parse(rest)
    expect(parsed.type === 'gungnir/verdict' && parsed.errorSignature).toBe('')
  })

  it('rejects wrong envelope version', () => {
    const event = verdictEvent({ criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' })
    expect(() => GungnirEventSchema.parse({ ...event, v: 2 })).toThrow()
  })

  it('parses loop events (stage-2 schema: mode/turn/step fields, no payload bag)', () => {
    const parsedState = GungnirEventSchema.parse({ type: 'gungnir/loop-state', v: 1, ts: 1, mode: 'EXECUTE', turn: 1, step: 1, transitionsCount: 1 })
    expect(parsedState.type).toBe('gungnir/loop-state')
    const parsedTransition = GungnirEventSchema.parse({ type: 'gungnir/loop-transition', v: 1, ts: 1, from: null, to: 'FAST', turn: 1, step: 1, rule: 'fast-no-goal-work' })
    expect(parsedTransition.type).toBe('gungnir/loop-transition')
    expect(() => GungnirEventSchema.parse({ type: 'gungnir/loop-state', v: 1, ts: 1, mode: 'IDLE', turn: 1, step: 1, transitionsCount: 0 })).toThrow()
  })

  it('makeEvent stamps the v:1 envelope', () => {
    const event = makeEvent({ type: 'gungnir/claim', round: 1 } as { type: 'gungnir/claim'; round: number }, ts())
    expect(event.v).toBe(1)
    expect(typeof event.ts).toBe('number')
  })

  it('firstSpecOf returns the first committed spec', () => {
    const spec = makeSpec()
    const other: GoalSpec = { ...makeSpec({ specId: 'spec-2' }) }
    const events = [
      specEvent(spec),
      specEvent(other),
    ]
    expect(firstSpecOf(events)?.specId).toBe('spec-1')
    expect(firstSpecOf([])).toBeNull()
  })

  it('evidence digest must be 64-char hex', () => {
    const event = { ...evidenceEvent({ round: 1 }), digest: 'short' }
    expect(() => GungnirEventSchema.parse(event)).toThrow()
    expect(sha256Of('a')).toMatch(/^[0-9a-f]{64}$/)
  })
})
