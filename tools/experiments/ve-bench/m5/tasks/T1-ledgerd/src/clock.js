/**
 * Shared test hooks: an injectable clock and id generator so callers can make
 * event timestamps and ids deterministic.
 */
export function fixedClock(ts) {
  return () => ts
}

let idCounter = 0
export function sequentialIds(prefix = 'evt') {
  return () => `${prefix}-${idCounter++}`
}

export function resetIdCounter() {
  idCounter = 0
}
