/**
 * CSV writer. Quoting rules are defined by the README: quote a field iff it
 * contains comma, double quote, LF or CR; double quotes inside quoted fields
 * are escaped by doubling.
 */
export function toCsv(columns, rows) {
  function renderField(value) {
    const text = String(value ?? '')
    if (/[",\n\r]/.test(text)) {
      return `"${text}"`
    }
    return text
  }

  const lines = [columns.map((column) => renderField(column.name)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => renderField(row[column.key])).join(','))
  }
  return lines.join('\n')
}
