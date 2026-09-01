/**
 * Balance snapshot cache. Balances are expensive to fold, so the cache is
 * reused while the event stream is unchanged; any append invalidates it.
 */
let cache = null

export function getBalance(ledger, account) {
  if (cache === null || ledger.eventCount() !== cache.atCount) {
    cache = { atCount: ledger.eventCount(), balances: ledger.fold() }
  }
  return cache.balances[account] ?? 0
}

export function resetSnapshotCache() {
  cache = null
}
