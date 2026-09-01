# ledgerd

An event-sourced account ledger. Every balance-changing operation is recorded as
an append-only event; balances are derived by folding the event stream.

## Design

- `createLedger()` — an append-only event store. Each event has
  `{ seq, id, type: 'debit' | 'credit', account, amountCents, ts }`.
- `fold()` — replays the whole stream and returns `{ account: balanceCents }`.
  Debits subtract, credits add.
- `transfer(ledger, from, to, amountCents, hooks)` — validates the sender's
  balance, appends a DEBIT then a CREDIT, then notifies `hooks.onSettled`.
- `getBalance(ledger, account)` — reads the balance through a snapshot cache.
  Folding the full stream on every read is expensive, so the cache is refreshed
  at most once every `REFRESH_EVERY` events and reused in between.
- Rebate feature: a `settled` hook can originate a follow-up transfer (for
  example a percentage rebate back to the sender). Rebates are ordinary
  transfers, so they notify hooks again.

## Invariants (authoritative)

1. The sum of all account balances is conserved — it never changes after the
   initial funding.
2. No account balance may ever go negative (no overdraft).
3. `getBalance(ledger, account)` must always equal the value obtained by folding
   the current event stream directly.

## Public API

`src/index.js` exports `createLedger`, `transfer`, `getBalance`,
`createRebateHook`, and `resetSnapshotCache`. Keep these exports unchanged.
