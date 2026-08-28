# csv-escape

CSV export for order reports.

## CSV rules (authoritative specification)

- `toCsv(columns, rows)`: `columns` is `[{ name, key }]`; the first record is the
  header (column `name`s); each further record renders `row[key]` per column.
- Fields are joined with `,`; records are joined with `\n` (LF). There is **no
  trailing newline** after the last record.
- A field is wrapped in double quotes **iff** it contains at least one of: `,`
  (comma), `"` (double quote), `\n`, `\r`.
- Inside a quoted field, every double quote is **escaped by doubling** (`""`).
  A quote inside a field that is not itself doubled produces malformed CSV.
- `null` and `undefined` field values render as the empty string (via `String(value ?? '')`).

## Formatting rules (authoritative specification)

- `formatAmount(cents)`: cents is an integer. Sign prefix `-` for negatives; the
  integer part is grouped with `,` every three digits (no leading group pad); the
  fractional part is always two digits. Examples: `1234567 -> "12,345.67"`,
  `-5 -> "-0.05"`, `0 -> "0.00"`.
- `formatIsoDate(epochMs)`: calendar date in **UTC**, `YYYY-MM-DD`, zero-padded.
  Example: `Date.UTC(2026, 7, 28, 23, 59, 59, 999) -> "2026-08-28"`.

## Public API (must not change)

- `src/csv.js`: `toCsv`
- `src/dates.js`: `formatIsoDate`
- `src/rows.js`: `formatAmount`, `shapeOrderRow`
- `src/export.js`: `exportOrders`
