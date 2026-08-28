import { roundHalfUpCents } from './money.js'

/**
 * Apply a percent coupon to a priced cart. Per the README, the coupon discount
 * is computed exactly once on the whole discounted subtotal, never per line.
 */
export function applyCoupon(priced, ratePercent) {
  if (ratePercent === null) {
    return { couponDiscount: 0, amountAfterCoupon: priced.discountedSubtotal }
  }
  const couponDiscount = roundHalfUpCents((priced.discountedSubtotal * ratePercent) / 100)
  return { couponDiscount, amountAfterCoupon: priced.discountedSubtotal - couponDiscount }
}
