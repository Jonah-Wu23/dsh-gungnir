/**
 * SwitchBench t04 probe: is the original bug still reproducible?
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

let runOrder
let parseTask
try {
  ;({ runOrder } = await import(pathToFileURL(join(workspace, 'src', 'scheduler.js')).href))
  ;({ parseTask } = await import(pathToFileURL(join(workspace, 'src', 'parse.js')).href))
} catch (error) {
  console.error(`probe import failed: ${error?.message ?? error}`)
  process.exit(2)
}

const failures = []
function expect(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

try {
  expect(
    'ordering across digit widths',
    runOrder([
      { id: 'a', priority: '2' },
      { id: 'b', priority: '10' },
      { id: 'c', priority: '1' },
    ]),
    ['c', 'a', 'b'],
  )
  expect('parsed priority is a number', typeof parseTask({ id: 'a', priority: '10' }).priority, 'number')
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
