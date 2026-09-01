# demo-pipeline

Order export pipeline with input validation + report formatting.

## Specification (authoritative)

- `validateRow(row)` returns `{ ok: true }` for a valid row, or `{ ok: false, reason }`
  for an invalid one. A row is valid iff it has exactly:
  `sku` (non-empty string), `qty` (positive integer), `amountCents` (integer >= 0).
- `exportPipeline(rows)` validates **every** row first; invalid rows are rejected
  (not exported) and counted. It returns `{ exported, rejectedCount, rejectedReasons }`
  where `exported` contains only valid rows in input order.
- The validation is **load-bearing**: `exportPipeline` MUST call `validateRow` for
  every row. Removing the validation must change behavior (invalid rows must then leak).
- `formatReport(records)` returns an array of text lines. The format is defined by
  `docs/FORMAT.md` (read it before implementing).
