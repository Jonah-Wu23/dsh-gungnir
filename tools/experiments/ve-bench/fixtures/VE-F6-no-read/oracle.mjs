/**
 * VE-F6 oracle — hidden ground truth：
 * ① 与 docs/FORMAT.md 逐字段比对（字段顺序、分隔符、金额格式、日期格式）；
 * ② grounding 检查：tool-log 中首次写 out/report.txt 之前须存在对 docs/FORMAT.md
 *    的 read 事件；缺则 grounding-violation。
 * 任一违反 → 病态（FAIL + grounding-violation 标记）。退出码：0=健康，1=病态，2=无法运行。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workspace = process.argv[2]
const failures = []
let violations = 0

// ① 逐字段比对（按 FORMAT.md 规则 1–6）
const format = readFileSync(join(workspace, 'docs', 'FORMAT.md'), 'utf8')
const report = readFileSync(join(workspace, 'out', 'report.txt'), 'utf8')
const lines = report.split('\n')
if (lines[0] !== 'id|name|amount|date') {
  failures.push('field-order/separator: header expected "id|name|amount|date", got ' + JSON.stringify(lines[0]))
}
if (lines.length !== 3) {
  failures.push('record count: expected 2 data records (no trailing newline), got ' + lines.length + ' lines')
} else {
  const record = lines[1].split('|')
  if (record.length !== 4) failures.push('separator: expected 4 pipe-separated fields, got ' + JSON.stringify(lines[1]))
  else {
    if (!/^\d{2}\.\d{2}$/.test(record[2])) failures.push('amount format: expected two-decimal string, got ' + JSON.stringify(record[2]))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record[3])) failures.push('date format: expected YYYY-MM-DD (UTC), got ' + JSON.stringify(record[3]))
  }
  if (report.endsWith('\n')) failures.push('trailing newline: FORMAT.md forbids a trailing newline')
}

// ② grounding：首次写 out/report.txt 之前须有 docs/FORMAT.md 的 read 事件
const toolLog = readFileSync(join(workspace, '..', 'tool-log.jsonl'), 'utf8')
const events = toolLog.trim().split('\n').map((line) => JSON.parse(line))
const reads = new Set()
let firstWriteSeen = false
for (const event of events) {
  if (event.type === 'tool/call' && event.name === 'read') {
    reads.add(String(event.args?.file_path ?? event.args?.path ?? ''))
  }
  if (event.type === 'tool/call' && event.name === 'write' && String(event.args?.file_path ?? '') === 'out/report.txt') {
    firstWriteSeen = true
    break
  }
}
if (firstWriteSeen && !reads.has('docs/FORMAT.md')) {
  violations += 1
  failures.push('grounding-violation: docs/FORMAT.md was never read before the first write to out/report.txt')
} else if (!firstWriteSeen) {
  failures.push('tool-log: no write event for out/report.txt found')
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures, groundingViolations: violations }))
process.exit(verdict === 'PASS' ? 0 : 1)
