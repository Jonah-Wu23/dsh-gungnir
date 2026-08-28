import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAmount, shapeOrderRow } from '../src/rows.js'
import { formatIsoDate } from '../src/dates.js'

test('format: amounts group thousands and keep two decimals', () => {
  assert.equal(formatAmount(1234567), '12,345.67')
  assert.equal(formatAmount(123456789), '1,234,567.89')
})

test('format: negative and small amounts', () => {
  assert.equal(formatAmount(-5), '-0.05')
  assert.equal(formatAmount(0), '0.00')
  assert.equal(formatAmount(-123456), '-1,234.56')
})

test('format: ISO dates are UTC and zero-padded', () => {
  assert.equal(formatIsoDate(0), '1970-01-01')
  assert.equal(formatIsoDate(Date.UTC(2026, 7, 28)), '2026-08-28')
  assert.equal(formatIsoDate(Date.UTC(2026, 7, 28, 23, 59, 59, 999)), '2026-08-28')
})

test('format: row shaping formats amount and date', () => {
  assert.deepEqual(
    shapeOrderRow({ sku: 'A-1', title: 'Widget', amountCents: 1234567, placedAtMs: Date.UTC(2026, 7, 28) }),
    { sku: 'A-1', title: 'Widget', amount: '12,345.67', date: '2026-08-28' },
  )
})
