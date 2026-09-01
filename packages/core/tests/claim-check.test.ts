import { describe, expect, it } from 'vitest'
import { sandboxCompatCommand, assessContractCriteria, unverifiableConflicts, type S2VerifyContext } from '../src/passive.ts'
import type { SuppliedProjection } from '../src/contract.ts'

describe('claim-check: sandboxCompatCommand (deterministic, narrow, auditable)', () => {
  it('rewrites bare `node --test` to in-process isolation', () => {
    expect(sandboxCompatCommand('node --test')).toBe('node --test --test-isolation=none')
  })

  it('rewrites `node --test <paths>` preserving the paths', () => {
    expect(sandboxCompatCommand('node --test test/args.test.js')).toBe('node --test --test-isolation=none test/args.test.js')
  })

  it('leaves other commands untouched', () => {
    expect(sandboxCompatCommand('node -e "process.exit(0)"')).toBe('node -e "process.exit(0)"')
    expect(sandboxCompatCommand('node --test --test-isolation=none')).toBe('node --test --test-isolation=none')
  })
})

describe('claim-check: assessContractCriteria (runtime L1/L2 evaluation)', () => {
  const supplied = (criteria: SuppliedProjection['criteria'], unverifiable?: SuppliedProjection['unverifiableCriteria']): SuppliedProjection => ({
    objective: 'fix it',
    criteria,
    ...(unverifiable !== undefined ? { unverifiableCriteria: unverifiable } : {}),
  })

  const makeCtx = (handlers: { commands?: Record<string, { exitCode: number; blocked?: boolean }>; files?: Record<string, string | null> }): S2VerifyContext => ({
    runCommand: async (command) => handlers.commands?.[command] ?? { exitCode: 0 },
    readFile: async (path) => handlers.files?.[path] ?? null,
    now: () => 0,
  })

  it('L1 exit_code PASS on expected exit code; FAIL otherwise (with sandbox-compat transform applied)', async () => {
    const ctx = makeCtx({ commands: { 'node --test --test-isolation=none': { exitCode: 0 } } })
    const assessment = await assessContractCriteria(
      supplied([{ id: 'c1-suite', description: 'suite', verifierLevel: 1, predicate: { kind: 'exit_code', command: 'node --test', expectedExitCode: 0, timeoutMs: 60_000 } }]),
      ctx,
    )
    expect(assessment.outcomes).toEqual([{ id: 'c1-suite', kind: 'exit_code', outcome: 'PASS', detailRef: 'cmd:node --test --test-isolation=none' }])
    expect(assessment.conflicts).toEqual([])
  })

  it('L1 FAIL produces a verify-command-failed conflict', async () => {
    const ctx = makeCtx({ commands: { 'node --test --test-isolation=none': { exitCode: 1 } } })
    const assessment = await assessContractCriteria(
      supplied([{ id: 'c1-suite', description: 'suite', verifierLevel: 1, predicate: { kind: 'exit_code', command: 'node --test', expectedExitCode: 0, timeoutMs: 60_000 } }]),
      ctx,
    )
    expect(assessment.outcomes[0]?.outcome).toBe('FAIL')
    expect(assessment.conflicts[0]?.kind).toBe('verify-command-failed')
  })

  it('sandbox-blocked command reports the blocked fact (never silently folded)', async () => {
    const ctx = makeCtx({ commands: { 'node --test --test-isolation=none': { exitCode: -1, blocked: true } } })
    const assessment = await assessContractCriteria(
      supplied([{ id: 'c1-suite', description: 'suite', verifierLevel: 1, predicate: { kind: 'exit_code', command: 'node --test', expectedExitCode: 0, timeoutMs: 60_000 } }]),
      ctx,
    )
    expect(assessment.conflicts[0]?.detail).toContain('blocked by the sandbox')
  })

  it('L2 artifact mustExist + contains semantics', async () => {
    const ctx = makeCtx({ files: { 'src/report.js': 'report body' } })
    const assessment = await assessContractCriteria(
      supplied([{ id: 'c2-report', description: 'report', verifierLevel: 2, predicate: { kind: 'artifact', path: 'src/report.js', mustExist: true, contains: 'body' } }]),
      ctx,
    )
    expect(assessment.outcomes[0]).toEqual({ id: 'c2-report', kind: 'artifact', outcome: 'PASS', detailRef: 'path:src/report.js' })
    expect(assessment.conflicts).toEqual([])
  })

  it('L2 missing artifact -> artifact-missing conflict', async () => {
    const ctx = makeCtx({ files: {} })
    const assessment = await assessContractCriteria(
      supplied([{ id: 'c2-report', description: 'report', verifierLevel: 2, predicate: { kind: 'artifact', path: 'src/report.js', mustExist: true } }]),
      ctx,
    )
    expect(assessment.outcomes[0]?.outcome).toBe('FAIL')
    expect(assessment.conflicts[0]?.kind).toBe('artifact-missing')
  })

  it('M-C: unverifiable criteria -> finalNotFullyPass + ids', async () => {
    const ctx = makeCtx({})
    const assessment = await assessContractCriteria(
      supplied([{ id: 'c1-suite', description: 'suite', verifierLevel: 1, predicate: { kind: 'exit_code', command: 'node --test', expectedExitCode: 0, timeoutMs: 60_000 } }], [{ id: 'c3-loss', description: '30% packet loss >= 99%' }]),
      ctx,
    )
    expect(assessment.unverifiableIds).toEqual(['c3-loss'])
    expect(assessment.finalNotFullyPass).toBe(true)
  })
})

describe('claim-check: unverifiableConflicts (M-C three-state into passive face)', () => {
  it('no unverifiable criteria -> no conflicts', () => {
    expect(unverifiableConflicts({ objective: 'x', criteria: [] })).toEqual([])
  })

  it('unverifiable criterion present -> unverifiable-claim conflict (completion blocked)', () => {
    const conflicts = unverifiableConflicts({ objective: 'x', criteria: [], unverifiableCriteria: [{ id: 'c3-loss', description: '30% packet loss >= 99%' }] })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.kind).toBe('unverifiable-claim')
    expect(conflicts[0]?.detail).toContain('c3-loss')
    expect(conflicts[0]?.detail).toContain('not verifiable in this environment')
  })
})
