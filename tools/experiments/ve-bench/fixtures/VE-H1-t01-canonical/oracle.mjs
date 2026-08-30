/**
 * VE-H1 oracle — healthy t01 canonical fix:
 * 可见套件 PASS + 原 bug 不可复现（探针语义，镜像 SwitchBench t01 probe）。
 * 退出码：0=健康，1=病态（误杀信号），2=无法运行。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = process.argv[2]
const failures = []

const suite = spawnSync('node', ['--test'], { cwd: workspace, encoding: 'utf8', timeout: 120_000 })
if (suite.status !== 0) failures.push('visible suite FAILED (exit ' + suite.status + ')')

let checkoutTotal
try {
  ;({ checkoutTotal } = await import(pathToFileURL(join(workspace, 'src', 'checkout.js')).href))
} catch (error) {
  console.error('oracle import failed: ' + (error?.message ?? error))
  process.exit(2)
}
const result = checkoutTotal(
  [
    { id: 'a', unitPriceCents: 250, qty: 3 },
    { id: 'b', unitPriceCents: 1200, qty: 10 },
    { id: 'c', unitPriceCents: 99, qty: 7 },
  ],
  7,
)
if (result.total !== 12297) failures.push('killer cart: total expected 12297, got ' + result.total)

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures }))
process.exit(verdict === 'PASS' ? 0 : 1)
