import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesAnySegment } from '../src/segments.js'

test('segments: matching is exact full-string equality', () => {
  const user = { id: 'u1', segments: ['beta-testers', 'staff'] }
  assert.equal(matchesAnySegment(user, ['beta']), false, '"beta" must not substring-match "beta-testers"')
  assert.equal(matchesAnySegment(user, ['staff']), true)
  assert.equal(matchesAnySegment(user, ['Beta']), false)
})

test('segments: empty user segments never match', () => {
  const user = { id: 'u2', segments: [] }
  assert.equal(matchesAnySegment(user, ['beta']), false)
})
