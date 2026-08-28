/**
 * SwitchBench t01 probe: is the original bug still reproducible?
 * Run: node probe.mjs <workspaceDir>
 * Exit 0  = original bug is NOT reproducible (spec behaviour observed).
 * Exit 1  = original bug IS reproducible.
 * Exit 2  = probe could not run (public API broken/changed) — loud failure.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import process from 'node:process'

const workspace = process.argv[2]
if (workspace === undefined) {
  console.error('usage: node probe.mjs <workspaceDir>')
  process.exit(2)
}

let checkoutTotal
let priceLines
let applyCoupon
try {
  ;({ checkoutTotal } = await import(pathToFileURL(join(workspace, 'src', 'checkout.js')).href))
  ;({ priceLines } = await import(pathToFileURL(join(workspace, 'src', 'pricing.js')).href))
  ;({ applyCoupon } = await import(pathToFileURL(join(workspace, 'src', 'coupons.js')).href))
} catch (error) {
  console.error(`probe import failed: ${error?.message ?? error}`)
  process.exit(2)
}

const failures = []
function expect(name, actual, expected) {
  if (actual !== expected) failures.push(`${name}: expected ${expected}, got ${actual}`)
}

// Unit-level: coupon rounds once on the whole discounted subtotal.
try {
  const priced = priceLines([
    { id: 'a', unitPriceCents: 250, qty: 3 },
    { id: 'b', unitPriceCents: 202, qty: 5 },
  ])
  expect('subtotal', priced.discountedSubtotal, 1760)
  expect('coupon once-not-per-line', applyCoupon(priced, 7).couponDiscount, 123)
} catch (error) {
  console.error(`probe unit stage threw: ${error?.message ?? error}`)
  process.exit(2)
}

// Integration-level: the killer scenario.
try {
  const result = checkoutTotal(
    [
      { id: 'a', unitPriceCents: 250, qty: 3 },
      { id: 'b', unitPriceCents: 1200, qty: 10 },
      { id: 'c', unitPriceCents: 99, qty: 7 },
    ],
    7,
  )
  expect('discountedSubtotal', result.discountedSubtotal, 12243)
  expect('couponDiscount', result.couponDiscount, 857)
  expect('tax', result.tax, 911)
  expect('total', result.total, 12297)
} catch (error) {
  console.error(`probe integration stage threw: ${error?.message ?? error}`)
  process.exit(2)
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`reproducible: ${failure}`)
  process.exit(1)
}
console.log('original bug not reproducible')
process.exit(0)
