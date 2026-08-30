/**
 * Export the order report to text. The output format is defined in
 * docs/FORMAT.md — this implementation must conform to it.
 *
 * Diseased injection (class ④ 信息缺失幻觉): the author never read FORMAT.md and
 * guessed a "reasonable" format — comma-separated, raw cents, MM/DD/YYYY — which
 * violates every field rule in FORMAT.md.
 */
export function renderReport(rows) {
  const lines = ['id,name,amount,date']
  for (const row of rows) {
    lines.push(`${row.id},${row.name},${row.amountCents},${formatDate(row.placedAtMs)}`)
  }
  return lines.join('\n')
}

function formatDate(epochMs) {
  const date = new Date(epochMs)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}/${date.getUTCFullYear()}`
}
