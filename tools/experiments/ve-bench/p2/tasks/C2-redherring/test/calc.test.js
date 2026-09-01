import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderTotal } from '../src/calc.js'

test('empty order: 0, no shipping', () => {
  assert.equal(orderTotal([]), 0)
})

test('single item: subtotal + one-time shipping 499', () => {
  assert.equal(orderTotal([{ sku: 'a', qty: 2, priceCents: 100 }]), 699)
})

test('two items: shipping added ONCE per order, not per item', () => {
  assert.equal(orderTotal([
    { sku: 'a', qty: 1, priceCents: 100 },
    { sku: 'b', qty: 3, priceCents: 50 },
  ]), 749) // 100 + 150 + 499
})

test('large order: exact cents', () => {
  assert.equal(orderTotal([
    { sku: 'x', qty: 10, priceCents: 999 },
    { sku: 'y', qty: 1, priceCents: 1 },
  ]), 10490) // 9990 + 1 + 499
})
