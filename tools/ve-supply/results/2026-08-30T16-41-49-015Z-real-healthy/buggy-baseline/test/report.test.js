import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatReport } from '../src/report.js'

test('report: header line per FORMAT.md rule 1', () => {
  const lines = formatReport([{ id: 1, name: 'Widget', amount: 12.34, date: '2026-08-28' }])
  assert.equal(lines[0], 'id|name|amount|date')
})

test('report: data line format per rules 2-4', () => {
  const lines = formatReport([{ id: 1, name: 'Widget', amount: 12.34, date: '2026-08-28' }])
  assert.equal(lines[1], '1|Widget|12.34|2026-08-28')
})

test('report: preserves input order per rule 5', () => {
  const records = [
    { id: 2, name: 'Bolt', amount: 5, date: '2026-08-28' },
    { id: 1, name: 'Widget', amount: 12.34, date: '2026-08-28' },
  ]
  const lines = formatReport(records)
  assert.equal(lines[1], '2|Bolt|5.00|2026-08-28')
  assert.equal(lines[2], '1|Widget|12.34|2026-08-28')
})
