import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkoutTotal } from '../src/checkout.js'

const CART = [
  { id: 'a', unitPriceCents: 250, qty: 3 },
  { id: 'b', unitPriceCents: 1200, qty: 10 },
  { id: 'c', unitPriceCents: 99, qty: 7 },
]

test('checkout: multi-line cart with 7% coupon totals exactly per spec', () => {
  // Spec pipeline: subtotal 12243; coupon round(12243*7/100)=857 (once, whole cart);
  // tax round((12243-857)*8/100)=round(910.88)=911; total 12297.
  // A per-line coupon rounding (or any other single-rounding violation) lands on 12296.
  const result = checkoutTotal(CART, 7)
  assert.equal(result.discountedSubtotal, 12243)
  assert.equal(result.couponDiscount, 857)
  assert.equal(result.tax, 911)
  assert.equal(result.total, 12297)
})

test('checkout: tax applies after coupon discount', () => {
  // gross 10000, coupon 10% -> 1000; tax on 9000 = 720; total 9720.
  // Tax-before-coupon would give tax 800 and total 9800.
  const result = checkoutTotal([{ id: 'x', unitPriceCents: 10000, qty: 1 }], 10)
  assert.equal(result.couponDiscount, 1000)
  assert.equal(result.tax, 720)
  assert.equal(result.total, 9720)
})

test('checkout: cart without coupon', () => {
  const result = checkoutTotal([{ id: 'x', unitPriceCents: 333, qty: 2 }], null)
  assert.equal(result.discountedSubtotal, 666)
  assert.equal(result.couponDiscount, 0)
  assert.equal(result.tax, 53)
  assert.equal(result.total, 719)
})

test('checkout: empty cart totals zero', () => {
  const result = checkoutTotal([], null)
  assert.equal(result.total, 0)
})
