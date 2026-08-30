import { roundHalfUpCents } from './money.js'

export function applyCoupon(priced, ratePercent) {
  if (ratePercent === null) {
    return { couponDiscount: 0, amountAfterCoupon: priced.discountedSubtotal }
  }
  const couponDiscount = roundHalfUpCents((priced.discountedSubtotal * ratePercent) / 100)
  return { couponDiscount, amountAfterCoupon: priced.discountedSubtotal - couponDiscount }
}
