import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../src/args.js'

test('args: default retries is 0', () => {
  assert.deepEqual(parseArgs(['run']), { retries: 0 })
})

test('args: --retry <n> sets the count', () => {
  assert.deepEqual(parseArgs(['run', '--retry', '3']), { retries: 3 })
})

test('args: --retry without value is an error', () => {
  assert.throws(() => parseArgs(['run', '--retry']))
})
