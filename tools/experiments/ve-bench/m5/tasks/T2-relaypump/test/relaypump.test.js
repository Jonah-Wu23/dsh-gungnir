import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQueue, retryWithBackoff, createDedup, createPump, createSink } from '../src/index.js'

test('queue: enqueue/dequeue/ack round trip', () => {
  const queue = createQueue()
  queue.enqueue({ id: 'a', key: 'K', payload: 1 })
  queue.enqueue({ id: 'b', key: 'K', payload: 2 })
  assert.equal(queue.dequeue().id, 'a')
  queue.ack('a')
  assert.equal(queue.dequeue().id, 'b')
  queue.ack('b')
  assert.equal(queue.dequeue(), null)
})

test('queue: dequeue removes the message; acked ids stay finalized', () => {
  const queue = createQueue()
  queue.enqueue({ id: 'a', key: 'K', payload: 1 })
  queue.enqueue({ id: 'b', key: 'K', payload: 2 })
  const first = queue.dequeue()
  assert.equal(first.id, 'a')
  // 'a' was removed; only 'b' remains
  assert.equal(queue.dequeue().id, 'b')
  queue.ack('a')
  queue.ack('b')
  assert.equal(queue.dequeue(), null)
})

test('retry: backoff grows exponentially and caps', () => {
  const retrier = retryWithBackoff(() => 0)
  assert.equal(retrier.delayFor(1), 100)
  assert.equal(retrier.delayFor(2), 200)
  assert.equal(retrier.delayFor(3), 400)
  assert.equal(retrier.delayFor(8), 5000)
})

test('retry: scheduleRetry advances from the injected clock', () => {
  const retrier = retryWithBackoff(() => 0)
  assert.equal(retrier.scheduleRetry(2, 1000), 1200)
})

test('dedup: duplicate within window is suppressed', () => {
  const dedup = createDedup({ windowMs: 100 })
  assert.equal(dedup.isDuplicate('m1', 0), false)
  dedup.record('m1', 0)
  assert.equal(dedup.isDuplicate('m1', 50), true)
})

test('dedup: entry expires after the window', () => {
  const dedup = createDedup({ windowMs: 100 })
  dedup.record('m1', 0)
  assert.equal(dedup.isDuplicate('m1', 101), false)
})

test('pump: happy path delivers every message once in order', () => {
  const queue = createQueue()
  const sink = createSink()
  const clock = { now: () => 0 }
  queue.enqueue({ id: 'm1', key: 'K1', payload: 'a' })
  queue.enqueue({ id: 'm2', key: 'K2', payload: 'b' })
  const pump = createPump({ queue, dedup: createDedup({ windowMs: 1000 }), sink, clock, processMessage: () => true })
  pump.run(10)
  assert.deepEqual(sink.deliveredIds(), ['m1', 'm2'])
  assert.equal(sink.hasDuplicate(), false)
})

test('pump: dedup suppresses a duplicate id in the queue', () => {
  const queue = createQueue()
  const sink = createSink()
  const clock = { now: () => 0 }
  queue.enqueue({ id: 'm1', key: 'K', payload: 1 })
  queue.enqueue({ id: 'm1', key: 'K', payload: 1 }) // duplicate id
  const pump = createPump({ queue, dedup: createDedup({ windowMs: 100000 }), sink, clock, processMessage: () => true })
  pump.run(10)
  assert.deepEqual(sink.deliveredIds(), ['m1'])
})

test('sink: reports duplicates in the delivered stream', () => {
  const sink = createSink()
  sink.emit({ id: 'm1' })
  sink.emit({ id: 'm1' })
  assert.equal(sink.hasDuplicate(), true)
})

test('pump: empty queue drains immediately', () => {
  const queue = createQueue()
  const sink = createSink()
  const pump = createPump({ queue, dedup: createDedup({ windowMs: 1000 }), sink, clock: { now: () => 0 }, processMessage: () => true })
  pump.run(10)
  assert.deepEqual(sink.deliveredIds(), [])
})
