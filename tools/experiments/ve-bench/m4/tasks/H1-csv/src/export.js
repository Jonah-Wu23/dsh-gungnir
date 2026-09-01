/**
 * CSV export per the README.
 *
 * Baseline bug: the data columns are emitted in the wrong order
 * (name,id,price,qty instead of id,name,qty,price).
 */
export function exportCSV(rows) {
  const lines = ['id,name,qty,price']
  for (const row of rows) {
    lines.push(`${row.name},${row.id},${row.price.toFixed(2)},${row.qty}`)
  }
  return lines.join('\n') + '\n'
}
