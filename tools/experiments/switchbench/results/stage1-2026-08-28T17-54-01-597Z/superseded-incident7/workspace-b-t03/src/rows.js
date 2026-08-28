import { formatIsoDate } from './dates.js'

/** Format integer cents as a display amount, e.g. 1234567 -> "12,345.67". */
export function formatAmount(cents) {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.trunc(abs / 100)
  const fraction = String(abs % 100).padStart(2, '0')
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}.${fraction}`
}

/** Shape a raw order record into a CSV row of strings. */
export function shapeOrderRow(order) {
  return {
    sku: order.sku,
    title: order.title,
    amount: formatAmount(order.amountCents),
    date: formatIsoDate(order.placedAtMs),
  }
}
