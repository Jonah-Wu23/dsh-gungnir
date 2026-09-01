# csv-export

CSV export for product rows.

## Specification (authoritative)

- `exportCSV(rows)` returns a CSV string with a header row.
- Header: `id,name,qty,price` (this exact order).
- Each data row: `id,name,qty,price` — `id` and `name` passed through unchanged,
  `qty` as integer, `price` with two decimal places.
- Cell values must be escaped: a value containing `,` or `"` is wrapped in double
  quotes, and embedded quotes are doubled.
- Input row order must be preserved.
