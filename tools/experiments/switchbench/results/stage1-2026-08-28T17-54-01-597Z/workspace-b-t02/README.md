# cache-keys

Small in-memory TTL cache with injectable clock.

## Specification (authoritative)

- `createCache({ clock = systemClock(), ttlMs = 60000, maxEntries = 100 })` returns
  `{ get, set, has, size }`.
- **Keys**: a key is normalized by trimming surrounding whitespace only. **Case is
  significant**: two keys that differ only in case are two distinct entries.
  The same normalization applies on `set` and on `get`.
- **Expiry**: an entry expires when `clock.now() - createdAt >= ttlMs`. An expired
  entry is purged lazily: on the first `get` that touches it (returning `undefined`
  and removing it). `size` counts stored entries, including expired-but-untouched ones.
- **Eviction**: inserting a new key when `size` already equals `maxEntries` first
  evicts the **oldest inserted** entry (FIFO by first insertion). Overwriting an
  existing key refreshes its value and `createdAt` but does **not** change its
  eviction order. Overwrites never trigger eviction.
- **has(key)** is exactly `get(key) !== undefined`.

## Public API (must not change)

- `src/keys.js`: `normalizeKey`
- `src/clock.js`: `systemClock`
- `src/cache.js`: `createCache`
- `src/api.js`: `readThrough`
