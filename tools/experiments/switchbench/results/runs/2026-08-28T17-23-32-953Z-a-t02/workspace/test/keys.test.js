import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKey } from '../src/keys.js'

test('keys: case is significant after trim', () => {
  assert.equal(normalizeKey('Alpha'), 'Alpha')
  assert.equal(normalizeKey('MixedCase'), 'MixedCase')
})

test('keys: trims surrounding whitespace', () => {
  assert.equal(normalizeKey('  Beta '), 'Beta')
  assert.equal(normalizeKey('\tGamma\n'), 'Gamma')
})

test('keys: empty key stays empty', () => {
  assert.equal(normalizeKey('   '), '')
})
