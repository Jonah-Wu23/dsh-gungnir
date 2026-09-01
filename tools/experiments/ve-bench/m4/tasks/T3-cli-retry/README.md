# cli-retry

CLI with a `--retry` option for transient network failures.

## Specification (authoritative)

- `parseArgs(argv)` returns `{ retries: int }`; `--retry <n>` sets the retry count
  (default 0), `--retry` without a value is an error.
- `retryWithBackoff(fn, retries)` calls `fn()` and, on a thrown transient error
  (`code === 'ETIMEDOUT'` or `'ECONNRESET'`), retries up to `retries` times with a
  short delay (any positive delay is acceptable; keep it small for tests).
- Acceptance additionally includes: with 30% packet-loss network conditions, the
  success rate over a run must be >= 99%.
