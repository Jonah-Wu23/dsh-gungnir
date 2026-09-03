import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FoldError } from 'gungnir-core'
import { AgentLedger } from 'dsh-gungnir/ledger.js'
import { FileKv } from '../src/file-kv.js'
import { AGENT } from './helpers.js'
import { describe, expect, it } from 'vitest'

/**
 * D-1：goal round 执行中 kill 进程 → 重启后 fold 重建的 GungnirState
 * 与破坏前语义等价（已提交事件一条不丢，未产生的事件自然缺席）。
 * D-4：DSH 会话 resume（新 AgentLedger.open）→ ledger 重放、状态缓存重建；
 * 且 strict replay 跨 resume 依然成立（坏事件拒载、停在坏事件处）。
 */

function childScript(): string {
  return new URL('../src/kill-child.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
}

describe('D-1 kill mid-round', () => {
  it('rebuilds the exact committed state from the ledger after SIGKILL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gungnir-d1-'))
    const kvFile = join(dir, 'ledger.json')

    // 子进程提交 4 个事件后被 SIGKILL
    const result = spawnSync(process.execPath, [childScript(), kvFile, AGENT], {
      cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      timeout: 30_000,
    })
    // SIGKILL 自杀：正常退出码为 null（signal）;Windows 上 exitCode 1 也可接受
    expect(result.status === null || result.signal !== null || result.status !== 0).toBe(true)

    // 父进程 = “重启后的 harness”：冷重建
    const reopened = FileKv.open(kvFile)
    const ledger = AgentLedger.open(AGENT, reopened)
    return ledger.then((rebuilt) => {
      const state = rebuilt.current
      // 未提交事件丢弃可接受，已提交事件一条不丢
      expect(state.eventsFolded).toBe(4)
      expect(state.spec?.specId).toBe('d1-spec')
      expect(state.phase).toBe('EXECUTING')
      expect(state.currentRound).toBe(1)
      expect(state.currentAction?.actionId).toBe('s1')
      expect(state.currentAction?.retried).toBe(0)
      expect(state.criteria['c1']?.satisfied).toBe(false)
      expect(state.seenEvidenceIds.has('ev-mid-round')).toBe(true)
      expect(state.verdictRuns).toBe(0)
      expect(state.roundsNoImprovement).toBe(0)
    })
  })

  it('continues the next append at the right sequence after rebuild', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gungnir-d1b-'))
    const kvFile = join(dir, 'ledger.json')
    spawnSync(process.execPath, [childScript(), kvFile, AGENT], {
      cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      timeout: 30_000,
    })

    const ledger = await AgentLedger.open(AGENT, FileKv.open(kvFile))
    await ledger.append({
      type: 'gungnir/verdict',
      specId: 'd1-spec',
      criterionId: 'c1',
      round: 1,
      verifier: { level: 2, kind: 'artifact' },
      outcome: 'PASS',
      errorSignature: '',
      detailRef: 'path:out/d1.md',
    })
    expect(ledger.current.verdictRuns).toBe(1)
    expect(ledger.current.criteria['c1']?.satisfied).toBe(true)
  })
})

describe('D-4 resume rebuild', () => {
  it('replays deterministically: two cold reopens produce equal states', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gungnir-d4-'))
    const kvFile = join(dir, 'ledger.json')
    spawnSync(process.execPath, [childScript(), kvFile, AGENT], {
      cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      timeout: 30_000,
    })

    const first = (await AgentLedger.open(AGENT, FileKv.open(kvFile))).current
    const second = (await AgentLedger.open(AGENT, FileKv.open(kvFile))).current
    expect(second).toEqual(first)
    expect(second.phase).toBe('EXECUTING')
  })

  it('refuses a ledger corrupted after the last good event (strict replay across resume)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gungnir-d4b-'))
    const kvFile = join(dir, 'ledger.json')
    spawnSync(process.execPath, [childScript(), kvFile, AGENT], {
      cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      timeout: 30_000,
    })

    // 破坏注入：往下一个 seq 塞一个断序事件（round 跳号）
    const kv = FileKv.open(kvFile)
    kv.corrupt((tables) => {
      const events = tables['events'] ?? {}
      events[`${AGENT}#0000000004`] = {
        type: 'gungnir/commit',
        v: 1,
        ts: Date.now(),
        specId: 'd1-spec',
        round: 9,
        actionId: 'ghost',
        summary: 'out-of-order commit',
        targetsCriteria: ['c1'],
        expectedEvidence: [],
        projectionId: null,
        stepId: null,
      }
    })
    await expect(AgentLedger.open(AGENT, kv)).rejects.toBeInstanceOf(FoldError)
  })
})
