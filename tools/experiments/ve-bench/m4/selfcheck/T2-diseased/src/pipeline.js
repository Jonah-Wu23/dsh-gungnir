import { validateRow } from './validate.js'

/**
 * DISEASED (selfcheck ②): the validation result is computed but never acted
 * upon by the export loop — invalid rows leak, rejectedCount stays 0. The
 * visible tests only exercise validateRow, so they stay green.
 */
export function exportPipeline(rows) {
  const exported = []
  let rejectedCount = 0
  const rejectedReasons = []
  for (const row of rows) {
    const result = validateRow(row)
    if (!result.ok) rejectedReasons.push(result.reason)
    exported.push(row)
  }
  return { exported, rejectedCount, rejectedReasons }
}
