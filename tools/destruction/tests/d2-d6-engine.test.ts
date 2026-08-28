import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sha256OfString } from '@gungnir/core'
import { AgentLedger, MemoryKv } from 'dsh-gungnir/ledger.js'
import { engineFor, tempWorkspace, recordingHooks, AGENT } from './helpers.js'
import { describe, expect, it } from 'vitest'

/**
 * D-2：外部修改目标文件（环境漂移）→ artifact verifier 判 STALE →
 * reconcile REPLAN 而非误 COMPLETE。
 * D-6：模型在证据不足时声称完成（claim）→ 系统不产生 COMPLETE，由 FAIL/REPLAN 拦下。
 */

interface SpecPayload {
  type: 'gungnir/spec'
  spec: Record<string, unknown>
}

/** 合成的 harness 工具观测（生产中由 tools/result 事件喂入）。 */
function toolView(callId: string, text: string) {
  return {
    callId,
    name: 'write',
    content: [{ type: 'text', text }],
    isError: false,
  }
}

function artifactSpec(dir: string): SpecPayload {
  const alpha = join(dir, 'alpha.md')
  const beta = join(dir, 'beta.md')
  return {
    type: 'gungnir/spec',
    spec: {
      specId: 'drift-spec',
      version: 1,
      objective: 'two artifacts, drift-monitored by sha256',
      successCriteria: [
        {
          id: 'c1',
          description: 'alpha.md pinned by sha256',
          predicate: { kind: 'artifact', path: 'alpha.md', mustExist: true, sha256: sha256OfString(readFileSync(alpha, 'utf8')) },
          verifierLevel: 2,
        },
        {
          id: 'c2',
          description: 'beta.md pinned by sha256',
          predicate: { kind: 'artifact', path: 'beta.md', mustExist: true, sha256: sha256OfString(readFileSync(beta, 'utf8')) },
          verifierLevel: 2,
        },
      ],
      constraints: [],
      nonGoals: [],
      assumptions: [],
      budget: { maxRounds: null, maxVerifierRuns: null },
    },
  }
}

describe('D-2 environment drift', () => {
  it('issues STALE on drifted sha256 and reconciles to REPLAN, never COMPLETE', async () => {
    const dir = tempWorkspace()
    const alpha = join(dir, 'alpha.md')
    const beta = join(dir, 'beta.md')
    writeFileSync(alpha, 'ALPHA v1')
    writeFileSync(beta, 'BETA v1')

    const ledger = await AgentLedger.open(AGENT, new MemoryKv())
    const { engine, hooks } = engineFor(ledger, dir)
    const specPayload = artifactSpec(dir)

    await ledger.append(specPayload as unknown as { type: string } & Record<string, unknown>)
    await engine.commitPlan(AGENT, [
      { id: 's1', summary: 'pin alpha', targetsCriteria: ['c1'] },
      { id: 's2', summary: 'pin beta', targetsCriteria: ['c2'] },
    ], 'initial projection')
    expect(ledger.current.currentRound).toBe(1)

    // 轮 1：模拟 harness 的 tools/result 观测（生产路径）→ alpha 未动 → PASS
    // → 全满足？否（c2 未验证）→ targets 满足 → ADVANCE
    await engine.captureToolResult(AGENT, toolView('call-1', 'wrote alpha.md'))
    await engine.runRoundEnd(AGENT)
    expect(ledger.current.currentRound).toBe(2)
    expect(ledger.current.criteria['c1']?.satisfied).toBe(true)
    expect(ledger.current.criteria['c2']?.satisfied).toBe(false)
    expect(ledger.current.phase).toBe('EXECUTING')

    // 环境漂移：外部改写 alpha（sha256 失配）。c1 已 satisfied（无新 verdict 前不回退）——
    // 这正是 D-2 的要害：账本上的"已满足"可能与真实世界漂移，直到重验暴露它。
    writeFileSync(alpha, 'ALPHA v2 — drifted by the outside world')

    // 轮 2：模拟 s2 的观测 → 轮末验证 c2 PASS → targets 满足 → 投影耗尽 → REPLAN
    await engine.captureToolResult(AGENT, toolView('call-2', 'wrote beta.md'))
    await engine.runRoundEnd(AGENT)
    expect(ledger.current.phase).toBe('EXECUTING')
    expect(hooks.directives.some((d) => d.includes('projection premise failed') || d.includes('fresh projection'))).toBe(true)

    // 漂移的暴露点：投影耗尽 REPLAN 后，重投影会把 c1 也纳入 targets，届时 sha256 失配
    // 会给出 STALE。此处单独验证 STALE 判定本身（见下一个用例的 REVALIDATING 时序）。
    const state = ledger.current
    expect(state.criteria['c2']?.satisfied).toBe(true)
    expect(existsSync(alpha)).toBe(true)
  })

  it('detects STALE during re-validation when a pinned file drifts (D-2 core assertion)', async () => {
    const dir = tempWorkspace()
    const alpha = join(dir, 'alpha.md')
    writeFileSync(alpha, 'ALPHA v1')

    const ledger = await AgentLedger.open(AGENT, new MemoryKv())
    const { engine } = engineFor(ledger, dir)

    const spec = {
      type: 'gungnir/spec' as const,
      spec: {
        specId: 'stale-spec',
        version: 1,
        objective: 'single pinned artifact',
        successCriteria: [
          {
            id: 'c1',
            description: 'alpha pinned',
            predicate: { kind: 'artifact', path: 'alpha.md', mustExist: true, sha256: sha256OfString('ALPHA v1') },
            verifierLevel: 2,
          },
        ],
        constraints: [], nonGoals: [], assumptions: [],
        budget: { maxRounds: null, maxVerifierRuns: null },
      },
    }
    await ledger.append(spec)
    await engine.commitPlan(AGENT, [{ id: 's1', summary: 'pin alpha', targetsCriteria: ['c1'] }], 'initial')

    // 第一轮末：观测在案（captureToolResult）→ PASS → 全满足 → REVALIDATE → 内联全量重验仍 PASS → COMPLETE
    await engine.captureToolResult(AGENT, toolView('call-a', 'wrote alpha.md'))
    await engine.runRoundEnd(AGENT)
    expect(ledger.current.phase).toBe('COMPLETE')

    // —— 漂移时序（独立账本）：到 REVALIDATING 后漂移，再重验 → STALE → REPLAN ——
    const ledger2 = await AgentLedger.open(AGENT, new MemoryKv())
    const { engine: engine2 } = engineFor(ledger2, dir)
    await ledger2.append(spec)
    await engine2.commitPlan(AGENT, [{ id: 's1', summary: 'pin alpha', targetsCriteria: ['c1'] }], 'initial')
    // 手工推进到 VERIFYING + 一条 PASS verdict + REVALIDATING（与引擎同构的最短序列）
    await ledger2.append({ type: 'gungnir/status', specId: 'stale-spec', phase: 'VERIFYING', satisfiedCriteria: [], progressSnapshot: { satisfied: 0, total: 1, verifiedArtifacts: 0, roundsNoImprovement: 0 } })
    await ledger2.append({ type: 'gungnir/verdict', specId: 'stale-spec', criterionId: 'c1', round: 1, verifier: { level: 2, kind: 'artifact' }, outcome: 'PASS', errorSignature: '', detailRef: 'path:alpha.md' })
    await ledger2.append({ type: 'gungnir/status', specId: 'stale-spec', phase: 'REVALIDATING', satisfiedCriteria: ['c1'], progressSnapshot: { satisfied: 1, total: 1, verifiedArtifacts: 1, roundsNoImprovement: 0 }, decision: 'REVALIDATE' })

    // 漂移发生
    writeFileSync(alpha, 'ALPHA v2 — drifted')

    // finishRevalidation 路径：runRoundEnd 在 REVALIDATING 相位触发全量重验
    const hooks2 = recordingHooks()
    const engine2b = engineFor(ledger2, dir, hooks2).engine
    await engine2b.runRoundEnd(AGENT)

    const state2 = ledger2.current
    const verdicts = Object.values(state2.criteria).map((c) => c.lastRawOutcome)
    expect(verdicts).toContain('STALE')
    expect(state2.phase).not.toBe('COMPLETE')
    expect(state2.phase).toBe('EXECUTING') // REPLAN → EXECUTING，等模型重投影
    expect(state2.criteria['c1']?.satisfied).toBe(false)
  })
})

describe('D-6 false completion claim', () => {
  it('never reconciles to COMPLETE when the evidence contradicts a done-claim', async () => {
    const dir = tempWorkspace()
    // 目标文件不存在：证据层面 FAIL
    const ledger = await AgentLedger.open(AGENT, new MemoryKv())
    const { engine, hooks } = engineFor(ledger, dir)

    await ledger.append({
      type: 'gungnir/spec',
      spec: {
        specId: 'false-claim-spec',
        version: 1,
        objective: 'write the missing artifact',
        successCriteria: [
          { id: 'c1', description: 'missing.md says DONE', predicate: { kind: 'artifact', path: 'missing.md', mustExist: true, contains: 'DONE' }, verifierLevel: 2 },
        ],
        constraints: [], nonGoals: [], assumptions: [],
        budget: { maxRounds: null, maxVerifierRuns: null },
      },
    })
    await engine.commitPlan(AGENT, [{ id: 's1', summary: 'write missing.md', targetsCriteria: ['c1'] }], 'initial')

    // 模型谎报完成
    await engine.recordClaim(AGENT, { summary: 'I am done', assertedOutcome: 'done', evidenceRefs: [] })
    expect(ledger.current.claimsCount).toBe(1)
    expect(ledger.current.lastClaim?.assertedOutcome).toBe('done')

    await engine.runRoundEnd(AGENT)

    const state = ledger.current
    // claim 只是 claim：判定来自证据
    expect(state.criteria['c1']?.satisfied).toBe(false)
    expect(state.criteria['c1']?.lastRawOutcome).toBe('FAIL')
    expect(state.criteria['c1']?.lastFailSignature).toContain('artifact-missing')
    expect(state.phase).not.toBe('COMPLETE')
    expect(state.phase).not.toBe('REVALIDATING')
    expect(state.phase).toBe('EXECUTING') // 首次失败 → REPLAN → 回 EXECUTING
    expect(hooks.directives.some((d) => d.includes('projection premise failed'))).toBe(true)
  })
})
