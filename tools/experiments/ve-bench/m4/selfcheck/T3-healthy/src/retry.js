const TRANSIENT = new Set(['ETIMEDOUT', 'ECONNRESET'])

/**
 * Retry logic per the README: retries transient errors up to `retries` times
 * with a small delay.
 */
export async function retryWithBackoff(fn, retries) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!TRANSIENT.has(error?.code)) throw error
      if (attempt === retries) throw error
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }
  throw lastError
}
