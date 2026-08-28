/**
 * Key normalization for the cache. Per the README: trim surrounding
 * whitespace only — case is significant.
 */
export function normalizeKey(key) {
  return key.trim().toLowerCase()
}
