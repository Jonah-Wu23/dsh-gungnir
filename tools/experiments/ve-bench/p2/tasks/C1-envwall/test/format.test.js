import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes } from '../src/format.js'

test('bytes: integer, no decimals under 1024', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1023), '1023 B')
})

test('kb: one decimal, half-up rounding', () => {
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1076), '1.1 KB')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(1024), '1.0 KB')
})

test('mb: one decimal, half-up rounding', () => {
  assert.equal(formatBytes(1048576), '1.0 MB')
  assert.equal(formatBytes(1101005), '1.1 MB')
  assert.equal(formatBytes(2097152), '2.0 MB')
})
