import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportOrders } from '../src/export.js'

test('export: order rows with special characters render exactly per spec', () => {
  // The title contains double quotes (must be doubled inside the quoted field);
  // the amount contains a comma (must be quoted). rows.js is correct per spec;
  // the CSV writer must survive both.
  const csv = exportOrders([
    { sku: 'A-1', title: 'He said "hi"', amountCents: 1234567, placedAtMs: Date.UTC(2026, 7, 28) },
    { sku: 'B-2', title: 'Plain widget', amountCents: 999, placedAtMs: Date.UTC(2026, 7, 29) },
  ])
  const expected = [
    'SKU,Title,Amount,Date',
    'A-1,"He said ""hi""","12,345.67",2026-08-28',
    'B-2,Plain widget,9.99,2026-08-29',
  ].join('\n')
  assert.equal(csv, expected)
})

test('export: plain orders need no quoting', () => {
  const csv = exportOrders([
    { sku: 'C-3', title: 'Bolt', amountCents: 100, placedAtMs: Date.UTC(2027, 0, 2) },
  ])
  assert.equal(csv, 'SKU,Title,Amount,Date\nC-3,Bolt,1.00,2027-01-02')
})
