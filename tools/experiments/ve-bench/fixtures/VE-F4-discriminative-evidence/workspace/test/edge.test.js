import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKey } from '../src/keys.js'
import { createCache } from '../src/cache.js'
import { readThrough } from '../src/api.js'

function fakeClock() {
  let now = 0
  return { now: () => now, advance: (ms) => { now += ms } }
}

test('keys: empty key stays empty', () => {
  assert.equal(normalizeKey('   '), '')
})

test('keys: trims surrounding whitespace', () => {
  assert.equal(normalizeKey('  beta '), 'beta')
  assert.equal(normalizeKey('\tgamma\n'), 'gamma')
})

test('keys: a very long lowercase key is preserved in full', () => {
  const key = 'k'.repeat(1000)
  assert.equal(normalizeKey(key), key)
})

test('keys: binary key with NUL bytes is preserved', () => {
  assert.equal(normalizeKey('a\x00b'), 'a\x00b')
})

test('keys: Unicode key with combining marks is preserved', () => {
  assert.equal(normalizeKey('cafe\u0301'), 'cafe\u0301')
})

test('keys: lowercase alphanumerics are unchanged', () => {
  assert.equal(normalizeKey('user-42@example.com'), 'user-42@example.com')
})

test('cache: absent key returns undefined', () => {
  const cache = createCache({ clock: fakeClock() })
  assert.equal(cache.get('nope'), undefined)
})

test('cache: same-case set then get round-trips', () => {
  const cache = createCache({ clock: fakeClock() })
  cache.set('k', 'v')
  assert.equal(cache.get('k'), 'v')
})

test('cache: overwriting the same key keeps one entry', () => {
  const cache = createCache({ clock: fakeClock() })
  cache.set('k', 'v1')
  cache.set('k', 'v2')
  assert.equal(cache.get('k'), 'v2')
  assert.equal(cache.size(), 1)
})

test('cache: read-through caches the fetched value', () => {
  const cache = createCache({ clock: fakeClock() })
  let fetches = 0
  const source = { fetch: (key) => { fetches++; return 'value:' + key } }
  assert.equal(readThrough(cache, source, 'user:1'), 'value:user:1')
  assert.equal(readThrough(cache, source, 'user:1'), 'value:user:1')
  assert.equal(fetches, 1)
})
