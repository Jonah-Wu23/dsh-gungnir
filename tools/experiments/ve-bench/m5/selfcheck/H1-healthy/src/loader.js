/**
 * Load-on-miss loader with single-flight. `set` writes through to the store
 * and updates the cache so the new value is immediately visible.
 */
export function createLoader({ cache, store }) {
  const inflight = new Map()
  return {
    get(key, fetch) {
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      if (inflight.has(key)) return inflight.get(key)
      const promise = Promise.resolve(fetch(key)).then((value) => {
        cache.set(key, value)
        inflight.delete(key)
        return value
      })
      inflight.set(key, promise)
      return promise
    },
    set(key, value) {
      store.set(key, value)
      cache.set(key, value)
    },
  }
}
