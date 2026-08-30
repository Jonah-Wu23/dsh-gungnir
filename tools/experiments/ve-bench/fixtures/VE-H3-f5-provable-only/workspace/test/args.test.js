import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../src/args.js'

test('args: --retry enables retry', () => {
  assert.equal(parseArgs(['node', 'cli.js', '--retry']).retry, true)
})

test('args: no --retry means off', () => {
  assert.equal(parseArgs(['node', 'cli.js']).retry, false)
})

test('args: unrelated flags do not enable retry', () => {
  assert.equal(parseArgs(['node', 'cli.js', '--verbose']).retry, false)
})
