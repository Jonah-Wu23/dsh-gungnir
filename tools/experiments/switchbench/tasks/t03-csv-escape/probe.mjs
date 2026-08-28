/**
 * SwitchBench t03 probe: is the original bug still reproducible?
 * Run: node probe.mjs <workspaceDir>
 * Exit 0 = bug not reproducible; 1 = reproducible; 2 = probe could not run.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import process from 'node:process'

const workspace = process.argv[2]
if (workspace === undefined) {
  console.error('usage: node probe.mjs <workspaceDir>')
  process.exit(2)
}

let toCsv
try {
  ;({ toCsv } = await import(pathToFileURL(join(workspace, 'src', 'csv.js')).href))
} catch (error) {
  console.error(`probe import failed: ${error?.message ?? error}`)
  process.exit(2)
}

const failures = []
function expect(name, actual, expected) {
  if (actual !== expected) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

try {
  const columns = [{ name: 'A', key: 'a' }]
  expect('plain unquoted', toCsv(columns, [{ a: 'x' }]), 'A\nx')
  expect('comma quoted', toCsv(columns, [{ a: '1,2' }]), 'A\n"1,2"')
  expect('quote doubled', toCsv(columns, [{ a: 'He said "hi"' }]), 'A\n"He said ""hi"""')
} catch (error) {
  console.error(`probe stage threw: ${error?.message ?? error}`)
  process.exit(2)
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`reproducible: ${failure}`)
  process.exit(1)
}
console.log('original bug not reproducible')
process.exit(0)
