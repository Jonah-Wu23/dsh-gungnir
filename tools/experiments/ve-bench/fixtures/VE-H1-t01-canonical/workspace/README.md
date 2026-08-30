# checkout-totals

Small checkout pricing library. All monetary amounts are **integer cents**.

## Pricing pipeline (authoritative specification)

For a cart of lines, where each line has `unitPriceCents` and `qty`:

1. `lineGross = unitPriceCents * qty` (exact integer product, never rounded).
2. **Bulk line discount**: if `qty >= 10`, `lineDiscount = roundHalfUpCents(lineGross * 10 / 100)`;
   otherwise `lineDiscount = 0`. The discount is computed **once per line**, never per unit.
3. `discountedSubtotal = sum of (lineGross - lineDiscount)` over all lines.
4. **Coupon**: a single coupon with an integer percent rate `rate` (may be `null` = no coupon).
   `couponDiscount = roundHalfUpCents(discountedSubtotal * rate / 100)` — computed **exactly once
   on the whole discounted subtotal**. It is never computed per line and never rounded per line.
5. **Tax**: `tax = roundHalfUpCents((discountedSubtotal - couponDiscount) * 8 / 100)` — tax is
   always applied **after** the coupon discount.
6. `total = discountedSubtotal - couponDiscount + tax`.

## Rounding rule (authoritative specification)

`roundHalfUpCents(x)` rounds to the nearest integer, halves round **up** (towards positive
infinity): `2.4 -> 2`, `2.5 -> 3`, `-0.5 -> 0` is never reachable because amounts are
non-negative. Every amount in the pipeline is rounded **at most once**, at the step that
defines it. Intermediate values are never rounded.

## Public API (must not change)

- `src/money.js`: `roundHalfUpCents`
- `src/pricing.js`: `priceLines(lines) -> { lines: [{ id, lineGross, lineDiscount, lineNet }], discountedSubtotal }`
- `src/coupons.js`: `applyCoupon(priced, ratePercent) -> { couponDiscount, amountAfterCoupon }`
- `src/tax.js`: `applyTax(amountAfterCoupon) -> { tax, amountWithTax }`
- `src/checkout.js`: `checkoutTotal(lines, couponRatePercent) -> { discountedSubtotal, couponDiscount, tax, total }`
