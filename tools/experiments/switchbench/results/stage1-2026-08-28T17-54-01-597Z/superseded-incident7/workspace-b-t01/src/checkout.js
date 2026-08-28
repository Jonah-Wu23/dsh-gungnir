import { priceLines } from './pricing.js'
import { applyCoupon } from './coupons.js'
import { applyTax } from './tax.js'

/** Full checkout pipeline: price lines, apply the coupon, then apply tax. */
export function checkoutTotal(lines, couponRatePercent) {
  const priced = priceLines(lines)
  const { couponDiscount, amountAfterCoupon } = applyCoupon(priced, couponRatePercent)
  const { tax } = applyTax(amountAfterCoupon)
  return {
    discountedSubtotal: priced.discountedSubtotal,
    couponDiscount,
    tax,
    total: amountAfterCoupon + tax,
  }
}
