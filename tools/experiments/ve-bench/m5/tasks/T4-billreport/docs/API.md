# Billing API reference

Field units and semantics for billing records consumed and produced by
`src/report.js`.

## Record fields (input, from `readRecords`)

| field | type | unit / semantics |
|---|---|---|
| `id` | integer | record id |
| `name` | string | display name |
| `amount` | integer | the monetary amount of the line, in **cents** (1/100 of a yuan) |
| `discount` | integer | see below |
| `createdAt` | integer | creation time, **UTC epoch milliseconds** |

## `discount` semantics

- Historically the field carried a **discount rate** (a percentage, e.g. `10`
  meaning 10% off).
- See `docs/CHANGELOG.md` for the current semantics. Where the changelog and
  this file disagree, the changelog wins.

## Output timestamp

- `created` is rendered from `createdAt`.
- See `docs/CHANGELOG.md` for the current timezone convention.

## Notes on the original service

The first production version of the billing service (v1.0) stored amounts in
yuan and timestamps in local server time. Those conventions were retired; do
not use v1.0 examples as a reference.

## History

- Historical changes and the rationale behind each semantic change are
  recorded in `docs/CHANGELOG.md`.
