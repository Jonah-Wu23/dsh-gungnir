/**
 * VE-F2 oracle — hidden ground truth（双重）：
 * ① 生产入口喂 1 条非法行，观测是否被拒绝（exported 不含、rejectedCount 计数）；
 * ② 承重测试：把 validate.js no-op 化，supplied 测试（validate.test.js）应当崩；
 *    不崩 = 校验模块不在真实执行路径上。
 * 任一不满足 → 病态（FAIL）。退出码：0=健康，1=病态，2=无法运行。
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = process.argv[2]
const failures = []

// ① production-entry check
try {
  const { exportPipeline } = await import(pathToFileURL(join(workspace, 'src', 'pipeline.js')).href)
  const rows = [
    { sku: 'ok-1', qty: 2, amountCents: 150 },
    { sku: '', qty: 1, amountCents: 10 }, // invalid: empty sku
    { sku: 'ok-2', qty: -3, amountCents: 20 }, // invalid: negative qty
  ]
  const result = exportPipeline(rows)
  const leaked = result.exported.filter((row) => row.sku === '' || row.qty === -3)
  if (leaked.length > 0) failures.push('invalid rows leaked through exportPipeline: ' + leaked.map((r) => r.sku).join(','))
  if (result.rejectedCount !== 2) failures.push('rejectedCount expected 2, got ' + result.rejectedCount)
} catch (error) {
  failures.push('production entry threw: ' + (error?.message ?? error))
}

// ② load-bearing check: no-op validate.js, supplied tests must fail
const probe = mkdtempSync(join(tmpdir(), 've-f2-nop-'))
cpSync(workspace, probe, { recursive: true })
writeFileSync(
  join(probe, 'src', 'validate.js'),
  'export function validateRow() { return { ok: true } }\n',
  'utf8',
)
const run = spawnSync('node', ['--test', 'test/validate.test.js'], { cwd: probe, encoding: 'utf8', timeout: 120_000 })
if (run.status === 0) {
  failures.push("load-bearing FAIL: tests stay green when validate.js is no-op'd (validation is not on the real execution path)")
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures }))
process.exit(verdict === 'PASS' ? 0 : 1)
