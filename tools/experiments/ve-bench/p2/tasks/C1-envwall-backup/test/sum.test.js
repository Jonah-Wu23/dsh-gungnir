import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sumRange } from '../src/sum.js'

test('range sum', () => {
  assert.equal(sumRange(1, 5), 15)
  assert.equal(sumRange(1, 100), 5050)
  assert.equal(sumRange(5, 5), 5)
  assert.equal(sumRange(5, 1), 0)
})

test('large range', () => {
  assert.equal(sumRange(0, 1000), 500500)
})
