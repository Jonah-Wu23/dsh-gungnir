/**
 * Export pipeline. Per the README the validation is load-bearing: every row
 * must be checked before export.
 *
 * Baseline: validation is NOT wired into the export loop — every row is exported
 * as-is, invalid rows leak through and nothing is counted.
 */
export function exportPipeline(rows) {
  const exported = []
  let rejectedCount = 0
  const rejectedReasons = []
  for (const row of rows) {
    exported.push(row)
  }
  return { exported, rejectedCount, rejectedReasons }
}
