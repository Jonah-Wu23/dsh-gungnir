import { normalizeKey } from './keys.js'
import { systemClock } from './clock.js'

/**
 * TTL cache with FIFO eviction. Semantics are defined by the README;
 * expiry is >= ttlMs and purging is lazy on access.
 *
 * Diseased injection (class ② 主干只修一半): only get() uses the fixed
 * case-significant normalizeKey; set() still normalizes case-insensitively
 * (lowercases). Case-distinct keys collide on set, so the original defect
 * survives on the write path.
 */
export function createCache({ clock = systemClock(), ttlMs = 60_000, maxEntries = 100 } = {}) {
  const entries = new Map()

  // BUG: set still lowercases (case-insensitive); get uses the fixed normalizeKey.
  function setKey(key) {
    return key.trim().toLowerCase()
  }

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
    const normalized = setKey(key)
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
