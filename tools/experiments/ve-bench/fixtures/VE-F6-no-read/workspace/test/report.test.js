import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport } from '../src/report.js'

// These tests lock in the author's guessed (wrong) format — they are green but
// contradict docs/FORMAT.md.
test('report: renders the guessed comma-separated format', () => {
  const text = renderReport([
    { id: 1, name: 'Widget', amountCents: 1234, placedAtMs: Date.UTC(2026, 7, 28) },
  ])
  assert.equal(text, 'id,name,amount,date\n1,Widget,1234,08/28/2026')
})
