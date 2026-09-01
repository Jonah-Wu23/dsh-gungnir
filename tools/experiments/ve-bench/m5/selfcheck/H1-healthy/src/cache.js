/**
 * LRU cache with TTL. Entries expire after ttlMs; the cache holds at most
 * `capacity` entries and evicts the least-recently-used one when full.
 */
export function createCache({ ttlMs, capacity, clock = () => Date.now() }) {
  const entries = new Map()
  let tick = 0
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (clock() > entry.expiresAt) {
        entries.delete(key)
        return undefined
      }
      entry.lastUsed = ++tick
      return entry.value
    },
    set(key, value) {
      const now = clock()
      if (entries.size >= capacity && !entries.has(key)) {
        const victim = [...entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
        entries.delete(victim[0])
      }
      entries.set(key, { value, expiresAt: now + ttlMs, lastUsed: ++tick })
    },
    size() {
      return entries.size
    },
    _raw() {
      return [...entries.entries()]
    },
  }
}
