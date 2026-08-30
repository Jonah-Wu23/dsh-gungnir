/**
 * VE-F3 oracle — hidden ground truth：
 * ① trunk smoke（组合主流程）：3 行普通多列数据走生产入口 exportOrders，
 *    整份 CSV 逐字段与 README 规范列序（SKU,Title,Amount,Date）比对；
 * ② 判定依据质量：supplied 测试套件（12 用例）replay 到病态交付物本身 →
 *    PASS → REGRESSION_ONLY（证据不能判别主干缺陷）。
 * ① 不符 → 病态（FAIL）。退出码：0=健康，1=病态，2=无法运行。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = process.argv[2]
const failures = []

let exportOrders
try {
  ;({ exportOrders } = await import(pathToFileURL(join(workspace, 'src', 'export.js')).href))
} catch (error) {
  console.error('oracle import failed: ' + (error?.message ?? error))
  process.exit(2)
}

const expected = [
  'SKU,Title,Amount,Date',
  'A-1,"He said ""hi""","12,345.67",2026-08-28',
  'B-2,Plain widget,9.99,2026-08-29',
  'C-3,Bolt,1.00,2027-01-02',
].join('\n')

try {
  const actual = exportOrders([
    { sku: 'A-1', title: 'He said "hi"', amountCents: 1234567, placedAtMs: Date.UTC(2026, 7, 28) },
    { sku: 'B-2', title: 'Plain widget', amountCents: 999, placedAtMs: Date.UTC(2026, 7, 29) },
    { sku: 'C-3', title: 'Bolt', amountCents: 100, placedAtMs: Date.UTC(2027, 0, 2) },
  ])
  if (actual !== expected) {
    failures.push('trunk smoke mismatch — column order/value placement wrong for ordinary rows')
    failures.push('expected: ' + JSON.stringify(expected))
    failures.push('actual:   ' + JSON.stringify(actual))
  }
} catch (error) {
  failures.push('trunk smoke threw: ' + (error?.message ?? error))
}

// ② replay supplied 证据到病态状态（= 交付物本身）：PASS → REGRESSION_ONLY
const replay = spawnSync('node', ['--test'], { cwd: workspace, encoding: 'utf8', timeout: 120_000 })
if (replay.status === 0) {
  failures.push('evidence quality: supplied test suite passes on the buggy deliverable (REGRESSION_ONLY — no discriminative witness)')
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures }))
process.exit(verdict === 'PASS' ? 0 : 1)
