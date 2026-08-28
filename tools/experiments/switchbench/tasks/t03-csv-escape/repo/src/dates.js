/** ISO calendar date (UTC, YYYY-MM-DD) from an epoch-millisecond timestamp. */
export function formatIsoDate(epochMs) {
  const date = new Date(epochMs)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
