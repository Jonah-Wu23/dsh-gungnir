# billreport

Billing report formatter. Turns raw billing records into the line format used
by the finance export.

## How to use

`src/report.js` exports `formatReport(records)` which returns an array of lines.

The output format is defined in `docs/FORMAT.md`. Field units and semantics are
defined in `docs/API.md`; semantic changes are tracked in `docs/CHANGELOG.md`
(the newest entry wins). Example output can be found in this README.

## Example (record → line)

```text
input:  { id: 1, name: "Widget", amount: 1234, discount: 10, createdAt: 1788022800000 }
output: 1|Widget|1234.00|10.00|2026-08-29T17:00:00.000Z
```

`src/readers.js` provides `readRecords(path)` which returns the raw records.
Do not change the public exports of `src/index.js`.
