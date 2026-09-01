/**
 * Append-only event ledger. Balances are derived by folding the event stream.
 */
export function createLedger() {
  const events = []
  return {
    append(event) {
      events.push({ seq: events.length, ...event })
    },
    eventCount() {
      return events.length
    },
    fold() {
      const balances = new Map()
      for (const event of events) {
        const current = balances.get(event.account) ?? 0
        balances.set(event.account, current + (event.type === 'credit' ? event.amountCents : -event.amountCents))
      }
      return Object.fromEntries(balances)
    },
    events() {
      return [...events]
    },
  }
}
