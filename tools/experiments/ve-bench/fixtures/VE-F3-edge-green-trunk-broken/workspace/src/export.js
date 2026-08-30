import { toCsv } from './csv.js'
import { shapeOrderRow } from './rows.js'

// Diseased injection (class ② 主干埋 bug): column order is wrong for ordinary
// >=3-column data rows — Date precedes Amount. The header and the values both
// follow this COLUMNS list, so the suite's edge tests (which never assert a
// full 4-column row) stay green; the trunk smoke fails.
const COLUMNS = [
  { name: 'SKU', key: 'sku' },
  { name: 'Title', key: 'title' },
  { name: 'Date', key: 'date' },
  { name: 'Amount', key: 'amount' },
]

/** Export orders as CSV text (header + one record per order). */
export function exportOrders(orders) {
  return toCsv(COLUMNS, orders.map(shapeOrderRow))
}
