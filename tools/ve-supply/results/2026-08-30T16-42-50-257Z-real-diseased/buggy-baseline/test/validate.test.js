import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRow } from '../src/validate.js'

test('validate: accepts a valid row', () => {
  assert.deepEqual(validateRow({ sku: 'A1', qty: 2, amountCents: 150 }), { ok: true })
})

test('validate: rejects a non-object row', () => {
  assert.deepEqual(validateRow(null), { ok: false, reason: 'not-an-object' })
})

test('validate: rejects a missing sku', () => {
  const result = validateRow({ qty: 2, amountCents: 150 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid-sku')
})

test('validate: rejects a non-positive qty', () => {
  const result = validateRow({ sku: 'A1', qty: 0, amountCents: 150 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid-qty')
})

test('validate: rejects a negative amount', () => {
  const result = validateRow({ sku: 'A1', qty: 2, amountCents: -5 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid-amount')
})
