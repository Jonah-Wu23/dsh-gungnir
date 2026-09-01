# checkout

Checkout total computation. The full pipeline is: price the lines, apply the
coupon, then apply tax.

## Specification (authoritative)

- A cart is a list of lines `{ unitPriceCents: int, qty: int }`.
- **Volume discount**: a line with `qty >= 10` gets 10% off its gross, rounded
  **half-up** to whole cents.
- **Coupon**: `couponRatePercent` is applied to the whole discounted subtotal
  (single rounding, **half-up**, not per line), or absent when `null`.
- **Tax**: 8% on the amount after the coupon, rounded **half-up** to whole cents.
- `checkoutTotal(lines, couponRatePercent)` returns
  `{ discountedSubtotal, couponDiscount, tax, total }` (all in cents).
- Half-up: `x.5` rounds away from zero (e.g. `52.5 → 53`).
