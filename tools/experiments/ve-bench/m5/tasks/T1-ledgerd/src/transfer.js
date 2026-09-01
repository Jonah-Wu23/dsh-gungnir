import { getBalance } from './snapshot.js'

/**
 * Transfer money between two accounts. Validates the sender's balance, appends
 * a DEBIT then a CREDIT, and finally notifies hooks.onSettled. The settled
 * notification runs after the ledger has been updated.
 */
export function transfer(ledger, from, to, amountCents, hooks = {}) {
  if (amountCents <= 0) throw new Error('amount must be positive')
  const balance = getBalance(ledger, from)
  if (balance < amountCents) throw new Error('insufficient funds')
  const ts = hooks.clock?.() ?? Date.now()
  ledger.append({ type: 'debit', account: from, amountCents, ts, id: hooks.nextId?.() ?? `evt-${ledger.eventCount()}` })
  ledger.append({ type: 'credit', account: to, amountCents, ts, id: hooks.nextId?.() ?? `evt-${ledger.eventCount()}` })
  hooks.onSettled?.({ from, to, amountCents, ts })
  return true
}
