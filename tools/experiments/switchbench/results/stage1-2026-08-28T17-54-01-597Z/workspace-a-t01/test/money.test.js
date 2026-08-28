import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roundHalfUpCents } from '../src/money.js'

test('money: rounds half up', () => {
  assert.equal(roundHalfUpCents(2.5), 3)
  assert.equal(roundHalfUpCents(52.5), 53)
})

test('money: rounds down below half', () => {
  assert.equal(roundHalfUpCents(2.4), 2)
  assert.equal(roundHalfUpCents(857.01), 857)
  assert.equal(roundHalfUpCents(910.88), 911)
})

test('money: zero stays zero', () => {
  assert.equal(roundHalfUpCents(0), 0)
})
