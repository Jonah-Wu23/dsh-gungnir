import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCache, createStore, createLoader } from '../src/index.js'

test('cache: get returns a stored value', () => {
  let now = 0
  const cache = createCache({ ttlMs: 1000, capacity: 10, clock: () => now })
  cache.set('a', 1)
  assert.equal(cache.get('a'), 1)
})

test('cache: get after TTL expiry is a miss', () => {
  let now = 0
  const cache = createCache({ ttlMs: 100, capacity: 10, clock: () => now })
  cache.set('a', 1)
  now = 101
  assert.equal(cache.get('a'), undefined)
})

test('cache: entry at exactly the TTL boundary is still valid', () => {
  let now = 0
  const cache = createCache({ ttlMs: 100, capacity: 10, clock: () => now })
  cache.set('a', 1)
  now = 100
  assert.equal(cache.get('a'), 1)
})

test('cache: set refreshes the TTL', () => {
  let now = 0
  const cache = createCache({ ttlMs: 100, capacity: 10, clock: () => now })
  cache.set('a', 1)
  now = 90
  cache.set('a', 2)
  now = 150
  assert.equal(cache.get('a'), 2)
})

test('cache: evicts the least-recently-used entry when full', () => {
  let now = 0
  const cache = createCache({ ttlMs: 100000, capacity: 2, clock: () => now })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('a') // a is now most recently used
  cache.set('c', 3) // must evict 'b' (least recently used)
  assert.equal(cache.size(), 2)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('c'), 3)
})

test('cache: get updates recency', () => {
  let now = 0
  const cache = createCache({ ttlMs: 100000, capacity: 2, clock: () => now })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('b')
  cache.set('c', 3) // must evict 'a'
  assert.equal(cache.get('a'), undefined)
  assert.equal(cache.get('b'), 2)
})

test('store: write-through persists and records the write time', () => {
  let now = 0
  const store = createStore(() => now)
  store.set('a', 1)
  assert.equal(store.read('a'), 1)
  assert.equal(store.written('a'), 0)
  now = 5
  store.set('a', 2)
  assert.equal(store.written('a'), 5)
})

test('loader: loads on miss via fetch', async () => {
  const cache = createCache({ ttlMs: 100000, capacity: 10 })
  const store = createStore()
  const loader = createLoader({ cache, store })
  const fetched = await loader.get('a', async (key) => `fetched:${key}`)
  assert.equal(fetched, 'fetched:a')
  assert.equal(cache.get('a'), 'fetched:a')
})

test('loader: single-flight shares one fetch for concurrent loads', async () => {
  const cache = createCache({ ttlMs: 100000, capacity: 10 })
  const store = createStore()
  const loader = createLoader({ cache, store })
  let fetches = 0
  const fetch = async (key) => {
    fetches += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return `value:${key}`
  }
  const [a, b] = await Promise.all([loader.get('k', fetch), loader.get('k', fetch)])
  assert.equal(a, 'value:k')
  assert.equal(b, 'value:k')
  assert.equal(fetches, 1)
})

test('loader: write-through makes the new value immediately visible', async () => {
  const cache = createCache({ ttlMs: 100000, capacity: 10 })
  const store = createStore()
  const loader = createLoader({ cache, store })
  await loader.get('a', async () => 'old')
  assert.equal(cache.get('a'), 'old')
  loader.set('a', 'new')
  assert.equal(await loader.get('a', async () => 'fetched-new'), 'new')
  assert.equal(store.read('a'), 'new')
})

test('loader: cache hit does not refetch', async () => {
  const cache = createCache({ ttlMs: 100000, capacity: 10 })
  const store = createStore()
  const loader = createLoader({ cache, store })
  let fetches = 0
  await loader.get('a', async (key) => {
    fetches += 1
    return key
  })
  await loader.get('a', async () => {
    fetches += 1
    return 'x'
  })
  assert.equal(fetches, 1)
})
