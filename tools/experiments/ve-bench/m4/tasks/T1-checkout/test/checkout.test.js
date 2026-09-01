import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkoutTotal } from '../src/checkout.js'

test('checkout: coupon discount rounds half-up (52.5 → 53)', () => {
  const result = checkoutTotal([{ unitPriceCents: 750, qty: 1 }], 7)
  assert.equal(result.couponDiscount, 53)
})

test('checkout: volume discount rounds half-up (27.5 → 28)', () => {
  const result = checkoutTotal([{ unitPriceCents: 25, qty: 11 }], null)
  assert.equal(result.discountedSubtotal, 275 - 28)
})

test('checkout: tax rounds half-up (74.4 → 74)', () => {
  const result = checkoutTotal([{ unitPriceCents: 500, qty: 2 }], 7)
  // subtotal 1000, coupon 70, amountAfterCoupon 930, tax 74.4 → 74
  assert.equal(result.tax, 74)
})

test('checkout: no coupon when rate is null', () => {
  const result = checkoutTotal([{ unitPriceCents: 100, qty: 1 }], null)
  assert.equal(result.couponDiscount, 0)
  assert.equal(result.total, 108)
})
