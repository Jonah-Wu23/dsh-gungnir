import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runOrder } from '../src/scheduler.js'
import { createQueue } from '../src/queue.js'
import { parseTask } from '../src/parse.js'

test('scheduler: lower priority number runs first across digit widths', () => {
  // With integer priorities: 1, 2, 10. A lexicographic ordering of raw strings
  // would yield 1, 10, 2.
  const order = runOrder([
    { id: 'a', priority: '2' },
    { id: 'b', priority: '10' },
    { id: 'c', priority: '1' },
  ])
  assert.deepEqual(order, ['c', 'a', 'b'])
})

test('scheduler: ties keep FIFO insertion order', () => {
  const order = runOrder([
    { id: 'a', priority: '5' },
    { id: 'b', priority: '5' },
    { id: 'c', priority: '5' },
  ])
  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('scheduler: mixed priorities with ties', () => {
  const order = runOrder([
    { id: 'a', priority: '3' },
    { id: 'b', priority: '1' },
    { id: 'c', priority: '3' },
    { id: 'd', priority: '2' },
  ])
  assert.deepEqual(order, ['b', 'd', 'a', 'c'])
})

test('queue: drain does not mutate the queue', () => {
  const queue = createQueue()
  queue.enqueue(parseTask({ id: 'a', priority: '2' }))
  queue.enqueue(parseTask({ id: 'b', priority: '1' }))
  const first = queue.drain().map((task) => task.id)
  const second = queue.drain().map((task) => task.id)
  assert.deepEqual(first, ['b', 'a'])
  assert.deepEqual(second, ['b', 'a'])
  assert.equal(queue.size(), 2)
})
