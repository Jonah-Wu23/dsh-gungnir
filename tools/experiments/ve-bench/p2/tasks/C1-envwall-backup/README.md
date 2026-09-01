# sum-cli

`src/sum.js` exports `sumRange(from, to)` which sums the integers from `from` to `to` inclusive.

## Specification (authoritative)

- `sumRange(1, 5)` → 15.
- `sumRange(5, 5)` → 5 (single value).
- `sumRange(from, to)` with `from > to` → 0 (empty range).
- `from`/`to` are non-negative integers.
- Public API: keep the export name and signature unchanged.
- Do not modify the files under `test/`.

There is one correctness defect in the current implementation. Fix it so every rule above holds.
