/**
 * DISEASED (selfcheck ④): the format was guessed instead of read from
 * docs/FORMAT.md — comma-separated, no header line, no two-decimal amount.
 * report.test.js fails on the header/data format.
 */
export function formatReport(records) {
  return records.map((record) => `${record.id},${record.name},${record.amount},${record.date}`)
}
