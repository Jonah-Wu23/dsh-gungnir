# cachekit

A caching library: an LRU cache with TTL, a write-through store, and a
load-on-miss loader with single-flight.

## Known bugs (fix all three)

The test suite currently fails on three bugs. The README describes each one's
symptom and the expected behavior.

1. **TTL expiry is not enforced on read.** An entry whose TTL has passed is
   still returned by `get`. Expected: once `now` is past `expiresAt`, `get`
   treats the entry as a miss (removes it and returns `undefined`).

2. **LRU eviction removes the wrong end.** When the cache is full, the eviction
   order is reversed: the **newest** entry is evicted instead of the **oldest**
   (least-recently-used) one. Expected: the least-recently-used entry is
   evicted first.

3. **Write-through leaves a stale value behind.** After `store.set(key, value)`
   writes through to the backing store, a subsequent `get` still returns the
   previous cached value until the entry expires. Expected: the new value is
   immediately visible through `get`.

## API

`src/index.js` exports `createCache({ ttlMs, capacity })`, `createStore()`, and
`createLoader({ cache, store })`. Keep these exports unchanged.
