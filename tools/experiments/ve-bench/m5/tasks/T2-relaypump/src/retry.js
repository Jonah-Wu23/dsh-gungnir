/**
 * Exponential backoff for retries. Delay grows 100ms, 200ms, 400ms, ... capped
 * at 5000ms. The injected clock is used to schedule retry times.
 */
export function retryWithBackoff(clock) {
  const base = 100
  const cap = 5000
  return {
    delayFor(attempt) {
      return Math.min(base * 2 ** Math.max(0, attempt - 1), cap)
    },
    scheduleRetry(attempt, now) {
      return now + this.delayFor(attempt)
    },
  }
}
