import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLedger, transfer, getBalance, resetSnapshotCache, createRebateHook, fixedClock } from '../src/index.js'

function fresh() {
  resetSnapshotCache()
  const ledger = createLedger()
  ledger.append({ type: 'credit', account: 'alice', amountCents: 10000, ts: 1, id: 'fund-alice' })
  ledger.append({ type: 'credit', account: 'bob', amountCents: 5000, ts: 2, id: 'fund-bob' })
  return ledger
}

test('transfer moves the balance between accounts', () => {
  const ledger = fresh()
  transfer(ledger, 'alice', 'bob', 3000, { clock: fixedClock(10) })
  const folded = ledger.fold()
  assert.equal(folded.alice, 7000)
  assert.equal(folded.bob, 8000)
})

test('fold reconstruction matches the event stream', () => {
  const ledger = fresh()
  transfer(ledger, 'alice', 'bob', 2500, { clock: fixedClock(10) })
  const folded = ledger.fold()
  assert.equal(folded.alice, 7500)
  assert.equal(folded.bob, 7500)
  assert.equal(ledger.eventCount(), 4)
})

test('insufficient funds throws and appends nothing', () => {
  const ledger = fresh()
  assert.throws(() => transfer(ledger, 'bob', 'alice', 99999, { clock: fixedClock(10) }), /insufficient funds/)
  assert.equal(ledger.eventCount(), 2)
})

test('amount must be positive', () => {
  const ledger = fresh()
  assert.throws(() => transfer(ledger, 'alice', 'bob', 0, {}), /amount must be positive/)
  assert.throws(() => transfer(ledger, 'alice', 'bob', -5, {}), /amount must be positive/)
})

test('rebate hook credits a percentage back to the sender', () => {
  const ledger = fresh()
  const hook = createRebateHook(ledger, 10)
  transfer(ledger, 'alice', 'bob', 1000, { onSettled: hook, clock: fixedClock(10) })
  const folded = ledger.fold()
  // rebate chain: alice→bob 1000, then bob→alice 100, then alice→bob 10, then bob→alice 1
  // alice: 10000 - 1000 + 100 - 10 + 1 = 9091; bob: 5000 + 1000 - 100 + 10 - 1 = 5909
  assert.equal(folded.alice, 9091)
  assert.equal(folded.bob, 5909)
})

test('rebate chain terminates when the rebate rounds to zero', () => {
  const ledger = fresh()
  const hook = createRebateHook(ledger, 3)
  transfer(ledger, 'alice', 'bob', 3000, { onSettled: hook, clock: fixedClock(10) })
  const folded = ledger.fold()
  assert.equal(folded.alice + folded.bob, 15000) // conserved
})

test('getBalance returns the funded balance before any transfer', () => {
  const ledger = fresh()
  assert.equal(getBalance(ledger, 'alice'), 10000)
  assert.equal(getBalance(ledger, 'bob'), 5000)
})

test('events are appended in debit-then-credit order', () => {
  const ledger = fresh()
  transfer(ledger, 'alice', 'bob', 500, { clock: fixedClock(10) })
  const events = ledger.events()
  assert.equal(events[2].type, 'debit')
  assert.equal(events[2].account, 'alice')
  assert.equal(events[3].type, 'credit')
  assert.equal(events[3].account, 'bob')
})

test('settled hook sees the transfer payload', () => {
  const ledger = fresh()
  const seen = []
  transfer(ledger, 'alice', 'bob', 700, { onSettled: (payload) => seen.push(payload), clock: fixedClock(10) })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].from, 'alice')
  assert.equal(seen[0].to, 'bob')
  assert.equal(seen[0].amountCents, 700)
})

test('distinct source accounts settle independently', () => {
  const ledger = fresh()
  transfer(ledger, 'alice', 'mallory', 2000, { clock: fixedClock(10) })
  transfer(ledger, 'bob', 'mallory', 1000, { clock: fixedClock(10) })
  const folded = ledger.fold()
  assert.equal(folded.alice, 8000)
  assert.equal(folded.bob, 4000)
  assert.equal(folded.mallory, 3000)
})
