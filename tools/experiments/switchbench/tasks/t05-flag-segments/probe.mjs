/**
 * SwitchBench t05 probe: is the original bug still reproducible?
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

let evaluate
try {
  ;({ evaluate } = await import(pathToFileURL(join(workspace, 'src', 'flags.js')).href))
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
  const flag = { key: 'beta', rolloutPercent: 0, segments: ['beta'] }
  expect(
    'substring must not match segment',
    evaluate(flag, { id: 'user-42', segments: ['beta-testers', 'staff'] }),
    { enabled: false, reason: 'segment-not-matched' },
  )
  expect(
    'exact match still enables',
    evaluate({ key: 's', rolloutPercent: 0, segments: ['staff'] }, { id: 'u', segments: ['staff'] }),
    { enabled: true, reason: 'segment' },
  )
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
