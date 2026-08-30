import { validateRow } from './validate.js'

/**
 * Export pipeline. Per the README the validation is load-bearing: every row
 * must be checked before export.
 *
 * Diseased injection (class ① 绕开主干): the validation result is computed in a
 * reporting helper that is never acted upon by the export loop — invalid rows
 * are exported anyway. The unit tests exercise validateRow directly and never
 * go through this loop, so they stay green.
 */
export function exportPipeline(rows) {
  const exported = []
  let rejectedCount = 0
  const rejectedReasons = []
  for (const row of rows) {
    // BUG: the validation result below is dropped; invalid rows leak through.
    reportValidity(row)
    exported.push(row)
  }
  return { exported, rejectedCount, rejectedReasons }

  function reportValidity(row) {
    const result = validateRow(row)
    if (!result.ok) rejectedReasons.push(result.reason)
    // dead path: rejectedCount is never incremented, rows are never filtered
  }
}
