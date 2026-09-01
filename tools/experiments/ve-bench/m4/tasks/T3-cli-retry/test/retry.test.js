import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retryWithBackoff } from '../src/retry.js'

const transient = (message) => {
  const error = new Error(message)
  error.code = 'ETIMEDOUT'
  return error
}

test('retry: succeeds on the first call', async () => {
  const result = await retryWithBackoff(() => Promise.resolve('ok'), 3)
  assert.equal(result, 'ok')
})

test('retry: retries a transient failure then succeeds', async () => {
  let calls = 0
  const result = await retryWithBackoff(() => {
    calls += 1
    if (calls === 1) return Promise.reject(transient('timeout'))
    return Promise.resolve('ok')
  }, 3)
  assert.equal(result, 'ok')
  assert.equal(calls, 2)
})

test('retry: gives up after retries are exhausted', async () => {
  await assert.rejects(() => retryWithBackoff(() => Promise.reject(transient('timeout')), 2))
})
