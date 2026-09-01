/**
 * Sliding-window idempotency guard by message id. Entries older than windowMs
 * are pruned on each check; a message whose id is still inside the window is a
 * duplicate.
 */
export function createDedup({ windowMs }) {
  const seenAt = new Map()
  return {
    isDuplicate(id, now) {
      for (const [key, ts] of seenAt) {
        if (now - ts > windowMs) seenAt.delete(key)
      }
      return seenAt.has(id)
    },
    record(id, now) {
      seenAt.set(id, now)
    },
  }
}
