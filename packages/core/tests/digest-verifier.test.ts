import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  effectiveOutcome,
  expectPredicate,
  sha256Of,
  sha256OfString,
  type SuccessCriterion,
} from '../src/index.ts'
import { makeSpec } from './fixtures.ts'

describe('digest determinism', () => {
  it('is stable across key order and undefined fields', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
    expect(canonicalJson({ z: [1, { c: 2, b: 3 }] })).toBe(canonicalJson({ z: [1, { b: 3, c: 2 }] }))
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson('x')).toBe('"x"')
    expect(canonicalJson(1n)).toBe('"1"')
  })

  it('produces identical sha256 for identical logical content', () => {
    expect(sha256Of({ a: [1, 2], b: 'x' })).toBe(sha256Of({ b: 'x', a: [1, 2] }))
    expect(sha256Of('different')).not.toBe(sha256Of({ a: [1, 2], b: 'x' }))
    expect(sha256OfString('hello')).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256OfString('hello')).toBe(sha256OfString('hello'))
  })
})

describe('ladder policy', () => {
  it('downgrades L4 PASS to PARTIAL and leaves other outcomes untouched', () => {
    expect(effectiveOutcome('PASS', 4)).toBe('PARTIAL')
    expect(effectiveOutcome('PASS', 2)).toBe('PASS')
    expect(effectiveOutcome('PASS', 1)).toBe('PASS')
    expect(effectiveOutcome('FAIL', 4)).toBe('FAIL')
    expect(effectiveOutcome('INCONCLUSIVE', 4)).toBe('INCONCLUSIVE')
    expect(effectiveOutcome('STALE', 2)).toBe('STALE')
    expect(effectiveOutcome('NEEDS_HUMAN', 4)).toBe('NEEDS_HUMAN')
  })
})

describe('verifier contract helpers', () => {
  const spec = makeSpec({ criteria: [{ id: 'c1', kind: 'exit_code' }] })
  const criterion = spec.successCriteria[0] as SuccessCriterion

  it('expectPredicate passes on matching kind/level', () => {
    const predicate = expectPredicate(criterion, 'exit_code', 1)
    expect(predicate.kind).toBe('exit_code')
    if (predicate.kind === 'exit_code') expect(predicate.expectedExitCode).toBe(0)
  })

  it('expectPredicate rejects mismatches loudly', () => {
    expect(() => expectPredicate(criterion, 'artifact', 1)).toThrow(/cannot handle/)
    expect(() => expectPredicate(criterion, 'exit_code', 2)).toThrow(/does not match criterion level/)
  })
})
