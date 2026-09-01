/**
 * Billing report formatter. Renders records into the line format used by the
 * finance export.
 */
export function formatReport(records) {
  const lines = ['id|name|amount|discount|created']
  for (const record of records) {
    const amount = (record.amount ?? 0).toFixed(2)
    const discount = (record.discount ?? 0).toFixed(2)
    const created = new Date(record.createdAt ?? 0).toISOString()
    lines.push(`${record.id}|${record.name}|${amount}|${discount}|${created}`)
  }
  return lines
}
