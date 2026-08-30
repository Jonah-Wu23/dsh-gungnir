import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceLines } from '../src/pricing.js'

test('pricing: bulk discount starts at qty 10', () => {
  const priced = priceLines([{ id: 'b', unitPriceCents: 100, qty: 10 }])
  assert.deepEqual(priced.lines, [{ id: 'b', lineGross: 1000, lineDiscount: 100, lineNet: 900 }])
  assert.equal(priced.discountedSubtotal, 900)
})

test('pricing: no bulk discount below qty 10', () => {
  const priced = priceLines([{ id: 'a', unitPriceCents: 100, qty: 9 }])
  assert.deepEqual(priced.lines, [{ id: 'a', lineGross: 900, lineDiscount: 0, lineNet: 900 }])
  assert.equal(priced.discountedSubtotal, 900)
})

test('pricing: discounted subtotal sums line nets', () => {
  const priced = priceLines([
    { id: 'a', unitPriceCents: 250, qty: 3 },
    { id: 'b', unitPriceCents: 1200, qty: 10 },
    { id: 'c', unitPriceCents: 99, qty: 7 },
  ])
  assert.equal(priced.discountedSubtotal, 750 + 10800 + 693)
})
