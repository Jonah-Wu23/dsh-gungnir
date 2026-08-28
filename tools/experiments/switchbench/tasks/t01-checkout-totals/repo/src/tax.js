import { roundHalfUpCents } from './money.js'

/** Apply 8% tax to the post-coupon amount. Tax is rounded exactly once. */
export function applyTax(amountAfterCoupon) {
  const tax = roundHalfUpCents((amountAfterCoupon * 8) / 100)
  return { tax, amountWithTax: amountAfterCoupon + tax }
}
