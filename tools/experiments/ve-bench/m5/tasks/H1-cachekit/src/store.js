/**
 * Write-through store: `set` persists to the backing map and must invalidate
 * the cache entry so the new value is visible immediately.
 */
export function createStore(clock = () => Date.now()) {
  const backing = new Map()
  const writtenAt = new Map()
  return {
    read(key) {
      return backing.get(key)
    },
    set(key, value) {
      backing.set(key, value)
      writtenAt.set(key, clock())
    },
    written(key) {
      return writtenAt.get(key)
    },
  }
}
