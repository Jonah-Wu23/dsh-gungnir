function escapeCell(value) {
  const text = String(value)
  if (text.includes(',') || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * CSV export per the README: header `id,name,qty,price`, correct column order,
 * proper escaping, input order preserved.
 */
export function exportCSV(rows) {
  const lines = ['id,name,qty,price']
  for (const row of rows) {
    lines.push([row.id, row.name, row.qty, row.price.toFixed(2)].map(escapeCell).join(','))
  }
  return lines.join('\n') + '\n'
}
