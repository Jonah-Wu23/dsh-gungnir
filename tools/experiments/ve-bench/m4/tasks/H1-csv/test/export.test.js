import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportCSV } from '../src/export.js'

test('csv: header and data column order', () => {
  const csv = exportCSV([{ id: 1, name: 'Widget', qty: 2, price: 12.34 }])
  assert.equal(csv.split('\n')[0], 'id,name,qty,price')
  assert.equal(csv.split('\n')[1], '1,Widget,2,12.34')
})

test('csv: escapes embedded comma and quotes', () => {
  const csv = exportCSV([{ id: 2, name: 'A, "B"', qty: 1, price: 5 }])
  assert.equal(csv.split('\n')[1], '2,"A, ""B""",1,5.00')
})

test('csv: preserves input order', () => {
  const csv = exportCSV([
    { id: 2, name: 'B', qty: 1, price: 5 },
    { id: 1, name: 'A', qty: 1, price: 5 },
  ])
  const lines = csv.split('\n')
  assert.equal(lines[1].startsWith('2,'), true)
  assert.equal(lines[2].startsWith('1,'), true)
})
