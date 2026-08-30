/**
 * VE-H2 oracle — healthy t03 canonical fix:
 * 可见套件 PASS + 原 bug 不可复现（探针语义，镜像 SwitchBench t03 probe）。
 * 退出码：0=健康，1=病态（误杀信号），2=无法运行。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = process.argv[2]
const failures = []

const suite = spawnSync('node', ['--test'], { cwd: workspace, encoding: 'utf8', timeout: 120_000 })
if (suite.status !== 0) failures.push('visible suite FAILED (exit ' + suite.status + ')')

let toCsv
try {
  ;({ toCsv } = await import(pathToFileURL(join(workspace, 'src', 'csv.js')).href))
} catch (error) {
  console.error('oracle import failed: ' + (error?.message ?? error))
  process.exit(2)
}
const columns = [{ name: 'A', key: 'a' }]
const expect = (name, actual, expected) => {
  if (actual !== expected) failures.push(name + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}
expect('plain unquoted', toCsv(columns, [{ a: 'x' }]), 'A\nx')
expect('comma quoted', toCsv(columns, [{ a: '1,2' }]), 'A\n"1,2"')
expect('quote doubled', toCsv(columns, [{ a: 'He said "hi"' }]), 'A\n"He said ""hi"""')

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures }))
process.exit(verdict === 'PASS' ? 0 : 1)
