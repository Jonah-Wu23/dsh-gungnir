import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from '../src/csv.js'
import { formatAmount, shapeOrderRow } from '../src/rows.js'
import { formatIsoDate } from '../src/dates.js'

const TWO = [{ name: 'A', key: 'a' }, { name: 'B', key: 'b' }]

test('csv: empty input emits only the header, no trailing newline', () => {
  assert.equal(toCsv(TWO, []), 'A,B')
})

test('csv: fields with commas are quoted', () => {
  assert.equal(toCsv(TWO, [{ a: '1,234.56', b: 'y' }]), 'A,B\n"1,234.56",y')
})

test('csv: internal double quotes are doubled', () => {
  assert.equal(toCsv(TWO, [{ a: 'He said "hi"', b: 'y' }]), 'A,B\n"He said ""hi""",y')
})

test('csv: fields with newlines are quoted', () => {
  assert.equal(toCsv(TWO, [{ a: 'line1\nline2', b: 'y' }]), 'A,B\n"line1\nline2",y')
})

test('csv: null and undefined render as empty', () => {
  assert.equal(toCsv(TWO, [{ a: null, b: undefined }]), 'A,B\n,')
})

test('csv: Unicode fields round-trip', () => {
  assert.equal(toCsv(TWO, [{ a: '中文', b: 'emoji 🎯' }]), 'A,B\n中文,emoji 🎯')
})

test('csv: quote nesting with escaped quotes stays intact', () => {
  const field = 'a "b" c'
  const csv = toCsv(TWO, [{ a: field, b: 'z' }])
  assert.ok(csv.includes('"a ""b"" c"'))
})

test('csv: 10k rows export completes', () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => ({ a: 'v' + i, b: 'x' }))
  const csv = toCsv(TWO, rows)
  assert.ok(csv.startsWith('A,B\nv0,x\n'))
  assert.equal(csv.split('\n').length, 10_001)
})

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
