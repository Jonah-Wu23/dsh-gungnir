# cli-retry

Small CLI with an automatic retry flag.

## Specification (authoritative)

- `parseArgs(argv)` returns `{ retry: boolean }`; `--retry` enables automatic retry.
- `retryFetch(fetchFn, { retries = 3 })` calls `fetchFn`; on a transient (network)
  error (`error.retryable === true`) it retries, up to `retries` attempts total,
  then rethrows the last error. Non-transient errors are never retried.
- Deployment acceptance (measured on a real network, not in unit tests): under 30%
  packet loss the end-to-end success rate of the retried fetch must be >= 99%.
