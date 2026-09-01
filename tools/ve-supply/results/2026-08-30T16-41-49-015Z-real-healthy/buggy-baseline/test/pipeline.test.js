import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportPipeline } from '../src/pipeline.js'

test('pipeline: rejects invalid rows at the production entry', () => {
  const rows = [
    { sku: 'ok-1', qty: 2, amountCents: 150 },
    { sku: '', qty: 1, amountCents: 10 }, // invalid: empty sku
    { sku: 'ok-2', qty: -3, amountCents: 20 }, // invalid: negative qty
  ]
  const result = exportPipeline(rows)
  assert.equal(result.rejectedCount, 2)
  assert.equal(result.exported.length, 1)
  assert.equal(result.exported[0].sku, 'ok-1')
})

test('pipeline: preserves input order for valid rows', () => {
  const rows = [
    { sku: 'b', qty: 1, amountCents: 1 },
    { sku: 'a', qty: 1, amountCents: 1 },
    { sku: 'c', qty: 1, amountCents: 1 },
  ]
  const result = exportPipeline(rows)
  assert.deepEqual(result.exported.map((row) => row.sku), ['b', 'a', 'c'])
})
