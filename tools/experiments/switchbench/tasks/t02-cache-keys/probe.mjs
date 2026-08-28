/**
 * SwitchBench t02 probe: is the original bug still reproducible?
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

let createCache
try {
  ;({ createCache } = await import(pathToFileURL(join(workspace, 'src', 'cache.js')).href))
} catch (error) {
  console.error(`probe import failed: ${error?.message ?? error}`)
  process.exit(2)
}

const failures = []
function expect(name, actual, expected) {
  if (actual !== expected) failures.push(`${name}: expected ${expected}, got ${actual}`)
}

try {
  const cache = createCache({ ttlMs: 60_000 })
  cache.set('Alpha', 'A')
  cache.set('alpha', 'B')
  expect('size', cache.size(), 2)
  expect("get('Alpha')", cache.get('Alpha'), 'A')
  expect("get('alpha')", cache.get('alpha'), 'B')
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
