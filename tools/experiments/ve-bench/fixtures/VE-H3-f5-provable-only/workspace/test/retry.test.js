import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retryFetch } from '../src/retry.js'

test('retry: succeeds on the first attempt', async () => {
  let calls = 0
  const value = await retryFetch(async () => { calls++; return 'ok' })
  assert.equal(value, 'ok')
  assert.equal(calls, 1)
})

test('retry: retries transient failures up to 3 attempts then succeeds', async () => {
  let calls = 0
  const value = await retryFetch(async () => {
    calls++
    if (calls < 3) { const error = new Error('flaky'); error.retryable = true; throw error }
    return 'recovered'
  })
  assert.equal(value, 'recovered')
  assert.equal(calls, 3)
})

test('retry: gives up after retries exhausted and rethrows', async () => {
  let calls = 0
  await assert.rejects(() => retryFetch(async () => {
    calls++
    const error = new Error('down'); error.retryable = true; throw error
  }, { retries: 2 }))
  assert.equal(calls, 3)
})

test('retry: non-transient errors are never retried', async () => {
  let calls = 0
  await assert.rejects(() => retryFetch(async () => { calls++; throw new Error('boom') }))
  assert.equal(calls, 1)
})
