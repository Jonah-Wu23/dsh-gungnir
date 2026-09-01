import { describe, expect, it } from 'vitest'
import {
  checkEffectivelyOnce,
  checkLedgerReentry,
  checkPerKeyOrder,
  generateLedgerReentryScenario,
  ledgerFoldFromEvents,
  type LedgerEventView,
} from '../src/ve.ts'

describe('M5 ledger-reentry 模板', () => {
  it('场景固定可复现（同 seed 同结构）', () => {
    expect(generateLedgerReentryScenario()).toEqual(generateLedgerReentryScenario())
    expect(generateLedgerReentryScenario().rebatePercent).toBe(10)
  })

  it('健康账本（每事件前缀守恒 + 无透支 + 快照==fold）通过检查', () => {
    const events: LedgerEventView[] = [
      { type: 'credit', account: 'alice', amountCents: 10000 },
      { type: 'debit', account: 'alice', amountCents: 6000 },
      { type: 'credit', account: 'bob', amountCents: 6000 },
      { type: 'debit', account: 'bob', amountCents: 600 },
      { type: 'credit', account: 'alice', amountCents: 600 },
    ]
    const folded = ledgerFoldFromEvents(events)
    expect(checkLedgerReentry(events, folded, 10000)).toEqual([])
  })

  it('快照陈旧（读 != fold）被拦下', () => {
    const events: LedgerEventView[] = [
      { type: 'credit', account: 'alice', amountCents: 10000 },
      { type: 'debit', account: 'alice', amountCents: 6000 },
      { type: 'credit', account: 'bob', amountCents: 6000 },
    ]
    const stale = { alice: 10000, bob: 0 } // 未反映后面的 debit/credit
    const failures = checkLedgerReentry(events, stale, 10000)
    expect(failures.some((failure) => failure.startsWith('snapshot read'))).toBe(true)
  })

  it('透支前缀被拦下', () => {
    const events: LedgerEventView[] = [
      { type: 'credit', account: 'alice', amountCents: 100 },
      { type: 'debit', account: 'alice', amountCents: 60 },
      { type: 'debit', account: 'alice', amountCents: 60 },
    ]
    const folded = ledgerFoldFromEvents(events)
    expect(checkLedgerReentry(events, folded, 100).some((failure) => failure.startsWith('overdraft'))).toBe(true)
  })

  it('守恒被破坏被拦下', () => {
    const events: LedgerEventView[] = [
      { type: 'credit', account: 'alice', amountCents: 100 },
      { type: 'credit', account: 'bob', amountCents: 100 }, // 非初始资金凭空入账 → 终局总额 200 != 100
    ]
    const folded = ledgerFoldFromEvents(events)
    expect(checkLedgerReentry(events, folded, 100).some((failure) => failure.startsWith('conservation'))).toBe(true)
  })
})

describe('M5 effectively-once 模板', () => {
  it('无重复无乱序 → 通过', () => {
    const delivered = [
      { id: 'm1', key: 'K' },
      { id: 'm2', key: 'K' },
    ]
    expect(checkEffectivelyOnce(delivered)).toEqual([])
    expect(checkPerKeyOrder(delivered, { K: ['m1', 'm2'] })).toEqual([])
  })

  it('重复交付被拦下', () => {
    const delivered = [
      { id: 'm1', key: 'K' },
      { id: 'm2', key: 'K' },
      { id: 'm1', key: 'K' },
    ]
    expect(checkEffectivelyOnce(delivered)).toEqual(['duplicate delivery of m1'])
  })

  it('per-key 乱序被拦下', () => {
    const delivered = [
      { id: 'm2', key: 'K' },
      { id: 'm1', key: 'K' },
    ]
    expect(checkPerKeyOrder(delivered, { K: ['m1', 'm2'] }).length).toBeGreaterThan(0)
  })

  it('不同 key 的序独立检查', () => {
    const delivered = [
      { id: 'a1', key: 'A' },
      { id: 'b1', key: 'B' },
      { id: 'a2', key: 'A' },
    ]
    expect(checkPerKeyOrder(delivered, { A: ['a1', 'a2'], B: ['b1'] })).toEqual([])
  })
})
