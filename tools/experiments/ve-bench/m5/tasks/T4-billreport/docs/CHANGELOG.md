# Changelog

All notable semantic changes to the billing report are recorded here. The
newest entry wins when this file conflicts with other documentation.

## v2.3 (2026-08-01)

- **Output timestamps are now rendered in the +08:00 timezone.** `created` must
  be an ISO-8601 string with an explicit `+08:00` offset (for example
  `2026-08-28T13:00:00.000+08:00`), converted from the UTC epoch-millisecond
  `createdAt`. Previous versions rendered `created` as a UTC ISO string
  (suffix `Z`); that is no longer correct.
- Rationale: the finance team operates in UTC+8; the export must be readable
  without timezone conversion.

## v2.2 (2026-07-15)

- No semantic change to the report format. Internal refactor of the billing
  pipeline; no field semantics changed.

## v2.1 (2026-06-20)

- **`discount` semantics changed from a discount rate to a discounted amount.**
  In v2.0 and earlier, `discount` carried a rate (percentage, e.g. `10` = 10%
  off). Starting with v2.1, `discount` carries the **final discounted amount
  in cents** (for example `123` = 1.23 yuan discounted). The report renders the
  field as-is (two decimal places); it must NOT be computed as
  `amount * rate / 100`.
- Rationale: rates were ambiguous across lines with different quantities; the
  downstream finance system now expects the discounted amount directly.

## v2.0 (2026-05-01)

- `amount` is now stored and reported in **cents** (1/100 of a yuan). In v1.x
  it was stored in yuan. The report renders `amount / 100` with two decimal
  places (e.g. `1234` cents → `12.34`).

## v1.0 (2025-01-01)

- Initial release. `amount` in yuan, `discount` as a rate, `created` in UTC.
  All of these conventions are retired by the entries above.
