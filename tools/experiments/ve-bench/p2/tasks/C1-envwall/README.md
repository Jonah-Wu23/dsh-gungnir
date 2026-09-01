# format-cli

`src/format.js` exports `formatBytes(bytes)` which converts a byte count into a
human-readable string.

## Specification (authoritative)

- `formatBytes(0)` → `"0 B"`.
- Values under 1024 → `"<n> B"` (integer, no decimals).
- 1024 ≤ n < 1048576 → `"<n> KB"` with **one decimal**, half-up rounding
  (e.g. `1536` → `"1.5 KB"`, `1076` → `"1.1 KB"`).
- 1048576 ≤ n < 1073741824 → `"<n> MB"` with **one decimal**, half-up rounding.
- `n` is always a non-negative integer; no negative input is possible.
- Public API: keep the export name and signature unchanged.
- Do not modify the files under `test/`.

There is one correctness defect in the current implementation. Fix it so every
rule above holds.
