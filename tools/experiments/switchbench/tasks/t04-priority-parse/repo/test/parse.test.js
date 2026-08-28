import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTask } from '../src/parse.js'

test('parse: priority is a non-negative integer in the parsed task', () => {
  const task = parseTask({ id: 'a', priority: ' 10 ' })
  assert.deepEqual(task, { id: 'a', priority: 10 })
  assert.equal(typeof task.priority, 'number')
})

test('parse: throws on non-numeric priority', () => {
  assert.throws(() => parseTask({ id: 'x', priority: 'soon' }), RangeError)
})

test('parse: throws on negative priority', () => {
  assert.throws(() => parseTask({ id: 'x', priority: '-3' }), RangeError)
})

test('parse: preserves the task id', () => {
  assert.equal(parseTask({ id: 'keep-me', priority: '7' }).id, 'keep-me')
})
