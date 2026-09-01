# metric-fmt

`src/fmt.js` exports `formatMetric(value)` which formats a metric value with a fixed unit suffix.

## Specification (authoritative)

- `formatMetric(12.5)` → `"12.5 req/s"`.
- `formatMetric(0)` → `"0 req/s"`.
- `formatMetric(n)` keeps at most two decimals, trimming trailing zeros (e.g. `3.1400` → `"3.14 req/s"`, `5.00` → `"5 req/s"`).
- `value` is always a non-negative finite number.
- Public API: keep the export name and signature unchanged.
- Do not modify the files under `test/`.

There is one correctness defect in the current implementation. Fix it so every rule above holds.
