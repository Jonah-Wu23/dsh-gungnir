import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatReport } from '../src/index.js'

const R = (overrides = {}) => ({
  id: 1,
  name: 'Widget',
  amount: 1234,
  discount: 123,
  createdAt: 1788022800000,
  ...overrides,
})

test('report: header line', () => {
  const lines = formatReport([R()])
  assert.equal(lines[0], 'id|name|amount|discount|created')
})

test('report: amount is cents rendered with two decimals', () => {
  const lines = formatReport([R({ amount: 1234 })])
  assert.equal(lines[1].split('|')[2], '12.34', 'field 3 mismatch')
  const lines2 = formatReport([R({ amount: 5 })])
  assert.equal(lines2[1].split('|')[2], '0.05', 'field 3 mismatch')
})

test('report: discount is rendered as the discounted amount', () => {
  const lines = formatReport([R({ discount: 123 })])
  assert.equal(lines[1].split('|')[3], '1.23', 'field 4 mismatch')
  const lines2 = formatReport([R({ discount: 0 })])
  assert.equal(lines2[1].split('|')[3], '0.00', 'field 4 mismatch')
})

test('report: created is an ISO timestamp in +08:00', () => {
  const lines = formatReport([R({ createdAt: 1788022800000 })])
  const created = lines[1].split('|')[4]
  assert.equal(created, '2026-08-30T01:00:00.000+08:00', 'field 5 mismatch')
})

test('report: a later timestamp also renders in +08:00', () => {
  const lines = formatReport([R({ createdAt: 1788026400000 })]) // +1h
  assert.equal(lines[1].split('|')[4], '2026-08-30T02:00:00.000+08:00', 'field 5 mismatch')
})

test('report: preserves input order', () => {
  const lines = formatReport([R({ id: 2, name: 'B' }), R({ id: 1, name: 'A' })])
  assert.equal(lines[1].split('|')[0], '2', 'field 1 mismatch')
  assert.equal(lines[2].split('|')[0], '1', 'field 1 mismatch')
})

test('report: name passes through unchanged', () => {
  const lines = formatReport([R({ name: 'Bolt, 3mm' })])
  assert.equal(lines[1].split('|')[1], 'Bolt, 3mm', 'field 2 mismatch')
})

test('report: discount is not computed from a rate', () => {
  // If the renderer treated discount=123 as a 123% rate it would fabricate a
  // discounted amount; the field must be passed through as the discounted
  // amount in cents.
  const lines = formatReport([R({ amount: 1000, discount: 123 })])
  assert.equal(lines[1].split('|')[3], '1.23', 'field 4 mismatch')
  assert.equal(lines[1].split('|')[2], '10.00', 'field 3 mismatch')
})

test('report: missing name renders an empty field', () => {
  const lines = formatReport([R({ name: '' })])
  assert.equal(lines[1].split('|')[1], '', 'field 2 mismatch')
})

test('report: id is passed through as an integer', () => {
  const lines = formatReport([R({ id: 42 })])
  assert.equal(lines[1].split('|')[0], '42', 'field 1 mismatch')
})
