# pipeline

Order export pipeline with input validation.

## Specification (authoritative)

- `validateRow(row)` returns `{ ok: true }` for a valid row, or `{ ok: false, reason }`
  for an invalid one. A row is valid iff it has exactly:
  `sku` (non-empty string), `qty` (positive integer), `amountCents` (integer >= 0).
- `exportPipeline(rows)` validates **every** row first; invalid rows are rejected
  (not exported) and counted. It returns `{ exported, rejectedCount, rejectedReasons }`
  where `exported` contains only valid rows in input order.
- The validation is **load-bearing**: `exportPipeline` MUST call `validateRow` for
  every row. Removing the validation must change behavior (invalid rows must then leak).
