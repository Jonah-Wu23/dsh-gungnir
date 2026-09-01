/**
 * Checkout pipeline per the README. Rounding must be half-up (single rounding
 * for the coupon, not per line).
 *
 * Baseline bug: Math.floor is used instead of half-up rounding — amounts with a
 * .5 fraction round down (e.g. 52.5 → 52 instead of 53).
 */
export function checkoutTotal(lines, couponRatePercent) {
  let discountedSubtotal = 0
  for (const line of lines) {
    const gross = line.unitPriceCents * line.qty
    const discount = line.qty >= 10 ? Math.floor((gross * 10) / 100) : 0
    discountedSubtotal += gross - discount
  }
  const couponDiscount = couponRatePercent === null ? 0 : Math.floor((discountedSubtotal * couponRatePercent) / 100)
  const amountAfterCoupon = discountedSubtotal - couponDiscount
  const tax = Math.floor((amountAfterCoupon * 8) / 100)
  return { discountedSubtotal, couponDiscount, tax, total: amountAfterCoupon + tax }
}
