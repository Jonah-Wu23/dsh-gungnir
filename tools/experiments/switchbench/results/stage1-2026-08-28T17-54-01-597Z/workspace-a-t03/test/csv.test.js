import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from '../src/csv.js'

const COLUMNS = [{ name: 'A', key: 'a' }, { name: 'B', key: 'b' }]

test('csv: plain fields need no quoting', () => {
  assert.equal(toCsv(COLUMNS, [{ a: 'x', b: 'y' }]), 'A,B\nx,y')
})

test('csv: fields with commas are quoted', () => {
  assert.equal(toCsv(COLUMNS, [{ a: '1,234.56', b: 'y' }]), 'A,B\n"1,234.56",y')
})

test('csv: internal double quotes are doubled', () => {
  assert.equal(
    toCsv(COLUMNS, [{ a: 'He said "hi"', b: 'y' }]),
    'A,B\n"He said ""hi""",y',
  )
})

test('csv: fields with newlines are quoted', () => {
  assert.equal(toCsv(COLUMNS, [{ a: 'line1\nline2', b: 'y' }]), 'A,B\n"line1\nline2",y')
})

test('csv: header is emitted even with no rows, without trailing newline', () => {
  assert.equal(toCsv(COLUMNS, []), 'A,B')
})

test('csv: null and undefined render as empty', () => {
  assert.equal(toCsv(COLUMNS, [{ a: null, b: undefined }]), 'A,B\n,')
})
