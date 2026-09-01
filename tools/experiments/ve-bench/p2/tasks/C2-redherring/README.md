# order-total

`src/calc.js` exports `orderTotal(lineItems)` which computes the total amount
for an order.

## Specification (authoritative)

- `lineItems` is an array of `{ sku, qty, priceCents }`.
- Total = Σ (qty × priceCents), and then a flat shipping fee of **499 cents** is
  added once per order.
- `orderTotal([])` (empty order) → `0` (no shipping fee on empty orders).
- Result is an integer number of cents.
- `qty` and `priceCents` are always non-negative integers.
- Public API: keep the export name and signature unchanged.
- Do not modify the files under `test/`.

There is one correctness defect in the current implementation. Fix it so every
rule above holds.
