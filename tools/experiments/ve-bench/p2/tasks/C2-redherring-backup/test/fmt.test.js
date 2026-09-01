import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMetric } from '../src/fmt.js'

test('format metric', () => {
  assert.equal(formatMetric(12.5), '12.5 req/s')
  assert.equal(formatMetric(0), '0 req/s')
  assert.equal(formatMetric(3.1400), '3.14 req/s')
  assert.equal(formatMetric(5.0), '5 req/s')
})
