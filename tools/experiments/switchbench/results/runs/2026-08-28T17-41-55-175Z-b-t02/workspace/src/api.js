/** Read-through helper: return the cached value or fetch, store and return it. */
export function readThrough(cache, source, key) {
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const value = source.fetch(key)
  cache.set(key, value)
  return value
}
