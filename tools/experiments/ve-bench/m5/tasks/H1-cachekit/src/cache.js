/**
 * LRU cache with TTL. Entries expire after ttlMs; the cache holds at most
 * `capacity` entries and evicts the least-recently-used one when full.
 */
export function createCache({ ttlMs, capacity, clock = () => Date.now() }) {
  const entries = new Map() // key -> { value, expiresAt, lastUsed }
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      entry.lastUsed = clock()
      return entry.value
    },
    set(key, value) {
      const now = clock()
      if (entries.size >= capacity && !entries.has(key)) {
        // evict one entry to make room
        const victim = [...entries.entries()].sort((a, b) => b[1].lastUsed - a[1].lastUsed)[0]
        entries.delete(victim[0])
      }
      entries.set(key, { value, expiresAt: now + ttlMs, lastUsed: now })
    },
    size() {
      return entries.size
    },
    _raw() {
      return [...entries.entries()]
    },
  }
}
