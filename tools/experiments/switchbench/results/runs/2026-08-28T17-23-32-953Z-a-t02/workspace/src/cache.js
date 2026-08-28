import { normalizeKey } from './keys.js'
import { systemClock } from './clock.js'

/**
 * TTL cache with FIFO eviction. Semantics are defined by the README;
 * expiry is `>= ttlMs` and purging is lazy on access.
 */
export function createCache({ clock = systemClock(), ttlMs = 60_000, maxEntries = 100 } = {}) {
  const entries = new Map()

  function get(key) {
    const normalized = normalizeKey(key)
    const entry = entries.get(normalized)
    if (entry === undefined) return undefined
    if (clock.now() - entry.createdAt >= ttlMs) {
      entries.delete(normalized)
      return undefined
    }
    return entry.value
  }

  function set(key, value) {
    const normalized = normalizeKey(key)
    const existing = entries.get(normalized)
    if (existing !== undefined) {
      existing.value = value
      existing.createdAt = clock.now()
      return
    }
    entries.set(normalized, { value, createdAt: clock.now() })
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      entries.delete(oldest)
    }
  }

  return {
    get,
    set,
    has: (key) => get(key) !== undefined,
    size: () => entries.size,
  }
}
