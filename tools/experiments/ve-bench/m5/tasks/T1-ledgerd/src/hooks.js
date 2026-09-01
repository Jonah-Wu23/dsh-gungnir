import { transfer } from './transfer.js'

/**
 * Rebate hook factory. After a transfer settles, a fixed-percentage rebate is
 * paid back to the sender. The rebate is itself an ordinary transfer, so it
 * triggers the hook again until the rebate rounds down to zero.
 */
export function createRebateHook(ledger, ratePercent) {
  const hook = ({ from, to, amountCents }) => {
    const rebate = Math.floor((amountCents * ratePercent) / 100)
    if (rebate <= 0) return
    transfer(ledger, to, from, rebate, { onSettled: hook })
  }
  return hook
}
