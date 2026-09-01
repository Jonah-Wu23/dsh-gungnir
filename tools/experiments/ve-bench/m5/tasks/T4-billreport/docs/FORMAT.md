# Billing report line format

This document defines the *text layout* of a billing report line. It does not
define units or field semantics — for those, see `docs/API.md`; semantic
changes are tracked in `docs/CHANGELOG.md` and the newest entry wins.

## Line layout

Each line is pipe-separated with exactly five fields:

```text
id|name|amount|discount|created
```

- `id`: the record id, an integer, passed through unchanged.
- `name`: the display name, passed through unchanged.
- `amount`: the monetary amount of the line, formatted with exactly two
  decimal places (e.g. `12.34`).
- `discount`: the discount value of the line, formatted with exactly two
  decimal places (e.g. `1.00`).
- `created`: the creation time of the record, formatted as an ISO-8601
  timestamp (see `docs/API.md` and `docs/CHANGELOG.md` for the timezone
  convention).

## Rules

1. The first line of the output must be the header `id|name|amount|discount|created`.
2. Each record is rendered on exactly one line, in input order.
3. `amount` and `discount` are always formatted with two decimal places.
4. A record with a missing or invalid `name` is still rendered (empty string is
   allowed).
5. The unit of `amount` and the semantics of `discount` are defined in
   `docs/API.md` (and may be amended by `docs/CHANGELOG.md`).
