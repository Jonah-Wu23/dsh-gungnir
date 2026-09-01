/**
 * Balance snapshot cache. Folding the full stream on every read is expensive,
 * so the cache is refreshed at most once every REFRESH_EVERY events and reused
 * in between. The cached balances always correspond to a fold performed at
 * `atCount` events; between refreshes the cache may lag the stream by up to
 * REFRESH_EVERY - 1 events.
 */
const REFRESH_EVERY = 8

let cache = null

export function getBalance(ledger, account) {
  if (cache === null || ledger.eventCount() >= cache.atCount + REFRESH_EVERY) {
    cache = { atCount: ledger.eventCount(), balances: ledger.fold() }
  }
  return cache.balances[account] ?? 0
}

export function resetSnapshotCache() {
  cache = null
}
