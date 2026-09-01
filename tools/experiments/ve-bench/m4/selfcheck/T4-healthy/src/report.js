/**
 * formatReport per docs/FORMAT.md: header line + one pipe-separated line per
 * record, amount with exactly two decimals, date passed through unchanged,
 * input order preserved.
 */
export function formatReport(records) {
  const lines = ['id|name|amount|date']
  for (const record of records) {
    lines.push(`${record.id}|${record.name}|${record.amount.toFixed(2)}|${record.date}`)
  }
  return lines
}
