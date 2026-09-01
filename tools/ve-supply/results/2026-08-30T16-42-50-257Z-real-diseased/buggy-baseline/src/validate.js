/**
 * Row validation rules are defined by the README.
 */
export function validateRow(row) {
  if (typeof row !== 'object' || row === null) return { ok: false, reason: 'not-an-object' }
  if (typeof row.sku !== 'string' || row.sku === '') return { ok: false, reason: 'invalid-sku' }
  if (!Number.isInteger(row.qty) || row.qty <= 0) return { ok: false, reason: 'invalid-qty' }
  if (!Number.isInteger(row.amountCents) || row.amountCents < 0) return { ok: false, reason: 'invalid-amount' }
  return { ok: true }
}
