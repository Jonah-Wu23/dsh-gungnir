/**
 * Checkout pipeline per the README. Rounding is half-up everywhere; the coupon
 * is applied to the whole discounted subtotal (single rounding, not per line).
 */
export function checkoutTotal(lines, couponRatePercent) {
  let discountedSubtotal = 0
  for (const line of lines) {
    const gross = line.unitPriceCents * line.qty
    const discount = line.qty >= 10 ? Math.floor((gross * 10) / 100 + 0.5) : 0
    discountedSubtotal += gross - discount
  }
  const couponDiscount = couponRatePercent === null ? 0 : Math.floor((discountedSubtotal * couponRatePercent) / 100 + 0.5)
  const amountAfterCoupon = discountedSubtotal - couponDiscount
  const tax = Math.floor((amountAfterCoupon * 8) / 100 + 0.5)
  return { discountedSubtotal, couponDiscount, tax, total: amountAfterCoupon + tax }
}
