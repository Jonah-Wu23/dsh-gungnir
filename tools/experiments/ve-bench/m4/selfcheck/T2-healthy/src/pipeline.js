import { validateRow } from './validate.js'

/**
 * Export pipeline with load-bearing validation per the README.
 */
export function exportPipeline(rows) {
  const exported = []
  let rejectedCount = 0
  const rejectedReasons = []
  for (const row of rows) {
    const result = validateRow(row)
    if (result.ok) {
      exported.push(row)
    } else {
      rejectedCount += 1
      rejectedReasons.push(result.reason)
    }
  }
  return { exported, rejectedCount, rejectedReasons }
}
