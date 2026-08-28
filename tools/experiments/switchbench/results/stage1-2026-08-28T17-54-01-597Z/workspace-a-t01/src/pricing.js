import { roundHalfUpCents } from './money.js'

/**
 * Price cart lines: gross per line, the 10% bulk discount for qty >= 10
 * (rounded once per line), and the discounted subtotal.
 */
export function priceLines(lines) {
  const priced = lines.map((line) => {
    const lineGross = line.unitPriceCents * line.qty
    const lineDiscount = line.qty >= 10 ? roundHalfUpCents((lineGross * 10) / 100) : 0
    const lineNet = lineGross - lineDiscount
    return { id: line.id, lineGross, lineDiscount, lineNet }
  })
  const discountedSubtotal = priced.reduce((sum, line) => sum + line.lineNet, 0)
  return { lines: priced, discountedSubtotal }
}
