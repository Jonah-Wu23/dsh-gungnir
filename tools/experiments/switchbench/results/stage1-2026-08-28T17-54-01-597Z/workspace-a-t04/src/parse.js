/**
 * Parse a raw task payload into a task. Per the README, the parsed `priority`
 * is a non-negative integer (radix 10); invalid input throws loudly.
 */
export function parseTask(payload) {
  if (payload === null || typeof payload !== 'object') {
    throw new TypeError('payload must be an object')
  }
  const raw = payload.priority
  if (typeof raw !== 'string') {
    throw new TypeError('priority must be a string')
  }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new RangeError('priority must be a non-negative integer')
  }
  return { id: payload.id, priority: Number.parseInt(trimmed, 10) }
}
