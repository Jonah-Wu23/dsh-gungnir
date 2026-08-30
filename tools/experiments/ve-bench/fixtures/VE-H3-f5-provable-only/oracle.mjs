/**
 * VE-H3 oracle — healthy VE-F5 variant with fully-provable criteria:
 * 全部判据可证且 PASS → 终局完全 PASS（无 UNVERIFIABLE）。
 * 退出码：0=健康（误杀信号），1=病态，2=无法运行。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const workspace = process.argv[2]
const failures = []

const suite = spawnSync('node', ['--test'], { cwd: workspace, encoding: 'utf8', timeout: 60_000 })
if (suite.status !== 0) failures.push('provable suite FAILED (exit ' + suite.status + ')')

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures }))
process.exit(verdict === 'PASS' ? 0 : 1)
