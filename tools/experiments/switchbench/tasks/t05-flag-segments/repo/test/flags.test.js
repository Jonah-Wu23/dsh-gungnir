import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate } from '../src/flags.js'
import { loadFlags } from '../src/config.js'
import { bucketFor } from '../src/hash.js'

test('flags: segment membership decides over rollout, by exact match only', () => {
  // rolloutPercent 0: only an exact segment match may enable the flag.
  // The user carries "beta-testers", NOT "beta" — the flag must stay disabled.
  const flag = { key: 'beta', rolloutPercent: 0, segments: ['beta'] }
  const user = { id: 'user-42', segments: ['beta-testers', 'staff'] }
  assert.deepEqual(evaluate(flag, user), { enabled: false, reason: 'segment-not-matched' })
})

test('flags: exact segment match enables', () => {
  const flag = { key: 'staff-only', rolloutPercent: 0, segments: ['staff'] }
  const user = { id: 'user-99', segments: ['staff'] }
  assert.deepEqual(evaluate(flag, user), { enabled: true, reason: 'segment' })
})

test('flags: rollout bucket decides without segments', () => {
  const flag = { key: 'wide', rolloutPercent: 100, segments: [] }
  assert.deepEqual(evaluate(flag, { id: 'user-42', segments: ['beta-testers'] }), {
    enabled: true,
    reason: 'rollout',
  })
  const closed = { key: 'closed', rolloutPercent: 0, segments: [] }
  assert.deepEqual(evaluate(closed, { id: 'user-42', segments: [] }), {
    enabled: false,
    reason: 'rollout-not-selected',
  })
})

test('flags: rollout honours the pinned bucket of the user', () => {
  // bucketFor('user-42') === 99 (frozen in hash.test.js).
  assert.equal(bucketFor('user-42'), 99)
  assert.equal(evaluate({ key: 'f', rolloutPercent: 99, segments: [] }, { id: 'user-42', segments: [] }).enabled, false)
  assert.equal(evaluate({ key: 'f', rolloutPercent: 100, segments: [] }, { id: 'user-42', segments: [] }).enabled, true)
})

test('config: rejects rolloutPercent out of range', () => {
  assert.throws(() => loadFlags([{ key: 'x', rolloutPercent: 101, segments: [] }]), RangeError)
  assert.throws(() => loadFlags([{ key: 'x', rolloutPercent: -1, segments: [] }]), RangeError)
  assert.throws(() => loadFlags([{ key: 'x', rolloutPercent: 50.5, segments: [] }]), RangeError)
})

test('config: returns defensive copies', () => {
  const source = [{ key: 'x', rolloutPercent: 10, segments: ['a'] }]
  const [flag] = loadFlags(source)
  flag.segments.push('b')
  assert.deepEqual(source[0].segments, ['a'])
})
