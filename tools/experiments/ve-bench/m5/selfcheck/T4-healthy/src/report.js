/**
 * Billing report formatter. Per docs/FORMAT.md + API.md + CHANGELOG.md:
 * amount is cents rendered with two decimals; discount is the discounted
 * amount in cents; created is the UTC epoch-ms converted to +08:00 ISO.
 */
export function formatReport(records) {
  const lines = ['id|name|amount|discount|created']
  for (const record of records) {
    const amount = ((record.amount ?? 0) / 100).toFixed(2)
    const discount = ((record.discount ?? 0) / 100).toFixed(2)
    const local = new Date((record.createdAt ?? 0) + 8 * 3600 * 1000).toISOString()
    const created = `${local.slice(0, -1)}+08:00`
    lines.push(`${record.id}|${record.name}|${amount}|${discount}|${created}`)
  }
  return lines
}
