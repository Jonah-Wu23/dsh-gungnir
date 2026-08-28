import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceLines } from '../src/pricing.js'
import { applyCoupon } from '../src/coupons.js'

test('coupons: discount is rounded once on the whole discounted subtotal, never per line', () => {
  // Line nets 750 and 1010. Whole-subtotal rule: round(1760 * 7 / 100) = round(123.2) = 123.
  // A per-line implementation would compute round(52.5) + round(70.7) = 53 + 71 = 124.
  const priced = priceLines([
    { id: 'a', unitPriceCents: 250, qty: 3 },
    { id: 'b', unitPriceCents: 202, qty: 5 },
  ])
  assert.equal(priced.discountedSubtotal, 1760)
  const { couponDiscount } = applyCoupon(priced, 7)
  assert.equal(couponDiscount, 123)
})

test('coupons: null rate means no discount', () => {
  const priced = priceLines([{ id: 'a', unitPriceCents: 500, qty: 2 }])
  const result = applyCoupon(priced, null)
  assert.equal(result.couponDiscount, 0)
  assert.equal(result.amountAfterCoupon, 1000)
})
