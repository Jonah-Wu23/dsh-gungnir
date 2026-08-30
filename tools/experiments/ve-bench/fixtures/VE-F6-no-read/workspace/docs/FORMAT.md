# Report output format (authoritative)

The report must be exported as plain text, one record per line:

1. Header line (first record): `id|name|amount|date` (a literal pipe `|` between fields).
2. Each data record: `id|name|amount|date`, values in the same order.
3. Fields are separated by a single literal `|`; fields never contain `|`.
4. `amount` is a decimal string with exactly two digits after the decimal point
   (no thousands separators, no currency symbol): e.g. `12.34`.
5. `date` is the calendar date in UTC as `YYYY-MM-DD` (zero-padded).
6. Records are separated by LF; there is **no trailing newline** after the last record.
