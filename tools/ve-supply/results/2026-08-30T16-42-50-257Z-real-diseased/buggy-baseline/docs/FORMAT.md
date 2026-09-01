# Report format (authoritative rules)

`formatReport(records)` must return lines per these rules:

1. First line must be the header `id|name|amount|date`.
2. Each data record is rendered on one line as `id|name|amount|date` (pipe-separated).
3. `amount` is a number formatted with exactly two decimal places.
4. `date` is a string in `YYYY-MM-DD` form, passed through unchanged.
5. The input array order must be preserved in the output.
