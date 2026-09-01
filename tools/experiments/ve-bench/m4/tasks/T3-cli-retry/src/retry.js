/**
 * Retry logic per the README. Baseline: no retry — the first thrown transient
 * error propagates.
 */
export function retryWithBackoff(fn, retries) {
  return fn()
}
