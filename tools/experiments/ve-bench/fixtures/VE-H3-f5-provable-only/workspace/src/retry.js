/** Retry a fetch-like async fn on transient (network) errors, up to retries attempts. */
export async function retryFetch(fetchFn, { retries = 3, delayMs = 5 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchFn()
    } catch (error) {
      lastError = error
      if (attempt < retries && error?.retryable === true) await sleep(delayMs)
      else throw error
    }
  }
  throw lastError
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
