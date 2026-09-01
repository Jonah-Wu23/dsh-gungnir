import { describe, expect, it } from 'vitest'
import {
  emptyEscalationCounters,
  errorSignatureOf,
  observeEscalationEvent,
  observeEscalationStep,
  decideSig1,
  decideRecover,
  SIG2_CONSECUTIVE_MAF,
  SIG2_CONSECUTIVE_RECOVER,
  SIG3_UNCHANGED_READS,
  SIG4_STALL_STEPS,
  SESSION_ESCALATION_BUDGET,
  buildSig2Maf,
  buildSig3Maf,
  buildSig4Maf,
  type EscalationSignal,
} from '../src/escalation.ts'

describe('escalation: errorSignatureOf (structural, no text sniffing)', () => {
  it('null when the result is clean (no error)', () => {
    expect(errorSignatureOf('pwsh', 'ok', false)).toBeNull()
  })

  it('sandbox-denied signature takes priority (EPERM wall is stable for C-1)', () => {
    expect(errorSignatureOf('pwsh', 'spawn EPERM denied', true)).toBe('pwsh:sandbox-denied')
    expect(errorSignatureOf('pwsh', 'permission denied', true)).toBe('pwsh:sandbox-denied')
  })

  it('failure markers -> :failure', () => {
    expect(errorSignatureOf('pwsh', '✖ failing tests', true)).toBe('pwsh:failure')
    expect(errorSignatureOf('pwsh', 'npm ERR! code 1', true)).toBe('pwsh:failure')
    expect(errorSignatureOf('node', 'error TS2307: cannot find', true)).toBe('node:failure')
  })

  it('generic error -> :error', () => {
    expect(errorSignatureOf('read', 'boom', true)).toBe('read:error')
  })
})

describe('escalation: SIG-2 repeated failure (same signature consecutive)', () => {
  it('three consecutive same-signature failures emit one SIG-2 MAF (once per signature)', () => {
    let state = emptyEscalationCounters()
    let signals: EscalationSignal[] = []
    for (let i = 0; i < 3; i++) {
      const r = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true })
      state = r.counters
      signals = r.signals
    }
    expect(signals).toHaveLength(1)
    expect(signals[0]?.signal).toBe('sig-2')
    expect(signals[0]?.count).toBe(SIG2_CONSECUTIVE_MAF)
    expect(signals[0]?.feedback).toContain('same command has failed')
  })

  it('a clean result in between resets the counter (no false SIG-2 across unrelated failures)', () => {
    let state = emptyEscalationCounters()
    for (let i = 0; i < SIG2_CONSECUTIVE_MAF; i++) {
      state = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true }).counters
    }
    state = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: 'ok', isError: false }).counters
    const { counters, signals } = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true })
    expect(counters.consecutiveErrors).toBe(1)
    expect(signals).toHaveLength(0)
  })

  it('a write/edit in between resets the failure streak (healthy fix cycles are not spin)', () => {
    let state = emptyEscalationCounters()
    for (let i = 0; i < SIG2_CONSECUTIVE_MAF; i++) {
      state = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: '✖ failing', isError: true }).counters
    }
    state = observeEscalationEvent(state, { type: 'tool/call', name: 'edit', path: 'src/cache.js' }).counters
    const { counters, signals } = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: '✖ failing', isError: true })
    expect(counters.consecutiveErrors).toBe(1)
    expect(signals).toHaveLength(0)
  })

  it('MAF fires once per signature; RECOVER only after MAF already sent and failure persists', () => {
    let state = emptyEscalationCounters()
    let sawMaf = false
    let sawRecover = false
    for (let i = 1; i <= SIG2_CONSECUTIVE_RECOVER; i++) {
      const r = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true })
      state = r.counters
      for (const s of r.signals) {
        if (s.signal === 'sig-2' && s.feedback.includes('same command has failed')) sawMaf = true
        if (s.signal === 'sig-2' && s.feedback.includes('persisted')) sawRecover = true
      }
    }
    expect(sawMaf).toBe(true)
    expect(sawRecover).toBe(true)
    // 同签名不再重复发
    const again = observeEscalationEvent(state, { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true })
    expect(again.signals).toHaveLength(0)
  })
})

describe('escalation: SIG-3 unchanged re-read (same read result text)', () => {
  it('three unchanged re-reads emit one SIG-3 MAF (first read is the baseline)', () => {
    let state = emptyEscalationCounters()
    let signals: EscalationSignal[] = []
    const readResult = { type: 'tool/result' as const, name: 'read', text: '<content>ERR_FIXED</content>', isError: false }
    for (let i = 0; i < SIG3_UNCHANGED_READS + 1; i++) {
      const r = observeEscalationEvent(state, readResult)
      state = r.counters
      signals = r.signals
    }
    expect(signals).toHaveLength(1)
    expect(signals[0]?.signal).toBe('sig-3')
    expect(signals[0]?.count).toBe(SIG3_UNCHANGED_READS)
    expect(signals[0]?.feedback).toContain('re-read the same file content')
  })

  it('a changed read resets the counter (content changed -> re-read is legitimate)', () => {
    let state = emptyEscalationCounters()
    for (let i = 0; i < SIG3_UNCHANGED_READS; i++) {
      state = observeEscalationEvent(state, { type: 'tool/result', name: 'read', text: '<content>A</content>', isError: false }).counters
    }
    state = observeEscalationEvent(state, { type: 'tool/result', name: 'read', text: '<content>B</content>', isError: false }).counters
    const { counters, signals } = observeEscalationEvent(state, { type: 'tool/result', name: 'read', text: '<content>B</content>', isError: false })
    expect(counters.unchangedReads['<content>B</content>']).toBe(1)
    expect(signals).toHaveLength(0)
  })

  it('a write to the path clears the counter', () => {
    let state = emptyEscalationCounters()
    for (let i = 0; i < SIG3_UNCHANGED_READS - 1; i++) {
      state = observeEscalationEvent(state, { type: 'tool/result', name: 'read', text: '<content>A</content>', isError: false }).counters
    }
    state = observeEscalationEvent(state, { type: 'tool/call', name: 'edit', path: 'A' }).counters
    const { counters, signals } = observeEscalationEvent(state, { type: 'tool/result', name: 'read', text: '<content>A</content>', isError: false })
    expect(counters.unchangedReads['<content>A</content>']).toBe(0)
    expect(signals).toHaveLength(0)
  })
})

describe('escalation: SIG-4 stall (consecutive steps without tool activity)', () => {
  it('N steps without tool activity emit one SIG-4 MAF, then re-arm', () => {
    let state = emptyEscalationCounters()
    let signals: EscalationSignal[] = []
    for (let i = 0; i < SIG4_STALL_STEPS; i++) {
      const r = observeEscalationStep(state, false)
      state = r.counters
      signals = r.signals
    }
    expect(signals).toHaveLength(1)
    expect(signals[0]?.signal).toBe('sig-4')
    expect(signals[0]?.count).toBe(SIG4_STALL_STEPS)
    // 触发后重置再计（不轰炸）
    const after = observeEscalationStep(state, false)
    expect(after.signals).toHaveLength(0)
    expect(after.counters.stepsWithoutToolCall).toBe(SIG4_STALL_STEPS + 1)
  })

  it('tool activity resets the stall counter', () => {
    let state = emptyEscalationCounters()
    for (let i = 0; i < SIG4_STALL_STEPS - 1; i++) {
      state = observeEscalationStep(state, false).counters
    }
    const { counters, signals } = observeEscalationStep(state, true)
    expect(counters.stepsWithoutToolCall).toBe(0)
    expect(signals).toHaveLength(0)
  })
})

describe('escalation: SIG-1 decision table (block + MAF; VERIFY only when M-A supplied and budget allows)', () => {
  it('no M-A template -> MAF only, no upgrade request', () => {
    const r = decideSig1(emptyEscalationCounters(), false, 'blocked feedback')
    expect(r.request).toBeNull()
    expect(r.maf).toBe('blocked feedback')
  })

  it('M-A template supplied -> VERIFY upgrade request, budget consumed', () => {
    const start = emptyEscalationCounters()
    const r = decideSig1(start, true, 'blocked feedback')
    expect(r.request).toEqual({ mode: 'VERIFY', signal: 'sig-1', feedback: 'blocked feedback' })
    expect(r.counters.escalationBudgetUsed).toBe(1)
  })

  it('budget exhausted -> MAF only (no more upgrades)', () => {
    const start = { ...emptyEscalationCounters(), escalationBudgetUsed: SESSION_ESCALATION_BUDGET }
    const r = decideSig1(start, true, 'blocked feedback')
    expect(r.request).toBeNull()
  })
})

describe('escalation: RECOVER decision respects the per-session budget', () => {
  it('budget available -> RECOVER request', () => {
    const r = decideRecover(emptyEscalationCounters(), 'recover feedback')
    expect(r.request?.mode).toBe('RECOVER')
    expect(r.counters.escalationBudgetUsed).toBe(1)
  })

  it('budget exhausted -> no request', () => {
    const start = { ...emptyEscalationCounters(), escalationBudgetUsed: SESSION_ESCALATION_BUDGET }
    const r = decideRecover(start, 'recover feedback')
    expect(r.request).toBeNull()
  })
})

describe('escalation: MAF builders stay task-level (AP-6, no control-plane concepts)', () => {
  it('no signal/trigger identifiers leak into feedback text', () => {
    for (const text of [buildSig2Maf('pwsh:sandbox-denied', 3), buildSig3Maf(3), buildSig4Maf(8)]) {
      expect(text).not.toMatch(/SIG|sig-\d|trigger|escalat/i)
    }
  })
})
