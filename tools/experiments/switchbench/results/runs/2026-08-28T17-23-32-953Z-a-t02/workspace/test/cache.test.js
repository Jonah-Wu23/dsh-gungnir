import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCache } from '../src/cache.js'
import { readThrough } from '../src/api.js'

function fakeClock() {
  let now = 0
  return { now: () => now, advance: (ms) => { now += ms } }
}

test('cache: keys that differ only in case are distinct entries', () => {
  const cache = createCache({ clock: fakeClock() })
  cache.set('Alpha', 'A')
  cache.set('alpha', 'B')
  assert.equal(cache.get('Alpha'), 'A')
  assert.equal(cache.get('alpha'), 'B')
  assert.equal(cache.size(), 2)
})

test('cache: surrounding whitespace is trimmed on set and get', () => {
  const cache = createCache({ clock: fakeClock() })
  cache.set('  Beta ', 'B')
  assert.equal(cache.get('Beta'), 'B')
  assert.equal(cache.get('  Beta'), 'B')
})

test('cache: entry expires at exactly ttlMs, not before', () => {
  const clock = fakeClock()
  const cache = createCache({ clock, ttlMs: 100 })
  cache.set('k', 'v')
  clock.advance(99)
  assert.equal(cache.get('k'), 'v')
  clock.advance(1)
  assert.equal(cache.get('k'), undefined)
})

test('cache: overwriting does not change eviction order', () => {
  const cache = createCache({ clock: fakeClock(), maxEntries: 2 })
  cache.set('a', 'A')
  cache.set('b', 'B')
  cache.set('a', 'A2')
  cache.set('c', 'C')
  assert.equal(cache.get('a'), undefined, 'a was the oldest first-inserted key')
  assert.equal(cache.get('b'), 'B')
  assert.equal(cache.get('c'), 'C')
})

test('cache: read-through caches the fetched value', () => {
  const cache = createCache({ clock: fakeClock() })
  let fetches = 0
  const source = { fetch: (key) => { fetches += 1; return `value:${key}` } }
  assert.equal(readThrough(cache, source, 'user:1'), 'value:user:1')
  assert.equal(readThrough(cache, source, 'user:1'), 'value:user:1')
  assert.equal(fetches, 1)
})
