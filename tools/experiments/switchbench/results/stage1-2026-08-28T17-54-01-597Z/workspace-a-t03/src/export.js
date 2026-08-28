import { toCsv } from './csv.js'
import { shapeOrderRow } from './rows.js'

const COLUMNS = [
  { name: 'SKU', key: 'sku' },
  { name: 'Title', key: 'title' },
  { name: 'Amount', key: 'amount' },
  { name: 'Date', key: 'date' },
]

/** Export orders as CSV text (header + one record per order). */
export function exportOrders(orders) {
  return toCsv(COLUMNS, orders.map(shapeOrderRow))
}
