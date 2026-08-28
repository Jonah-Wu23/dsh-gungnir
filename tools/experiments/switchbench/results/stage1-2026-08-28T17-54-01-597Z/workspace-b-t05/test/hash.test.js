import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stableHash, bucketFor } from '../src/hash.js'

test('hash: deterministic across calls', () => {
  assert.equal(stableHash('user-42'), stableHash('user-42'))
  const bucket = bucketFor('user-42')
  assert.ok(Number.isInteger(bucket) && bucket >= 0 && bucket < 100)
})

test('hash: pinned bucket values (FNV-1a, 100 buckets)', () => {
  assert.equal(bucketFor('user-42'), 99)
  assert.equal(bucketFor('user-99'), 31)
  assert.equal(stableHash('alice'), 2267157479)
})

test('hash: buckets stay in range for assorted ids', () => {
  for (const id of ['a', 'bob', 'carol', 'user-7', 'someone-with-a-long-id-123456']) {
    const bucket = bucketFor(id)
    assert.ok(bucket >= 0 && bucket < 100, `${id} -> ${bucket}`)
  }
})
