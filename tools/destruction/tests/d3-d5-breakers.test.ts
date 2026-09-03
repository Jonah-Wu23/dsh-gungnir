import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandObservation, VerifyContext } from 'gungnir-core'
import { AgentLedger, MemoryKv } from 'dsh-gungnir/ledger.js'
import { FileKv } from '../src/file-kv.js'
import { ReconcileEngine, type EngineHooks } from 'dsh-gungnir/engine.js'
import { ExitCodeVerifier } from 'dsh-gungnir/verifiers/exit-code.js'
import { tempWorkspace, AGENT } from './helpers.js'
import { describe, expect, it } from 'vitest'

/**
 * D-3：工具执行失败注入 —— FAIL 路径正确，transient 判定（同签名复发）与
 * RETRY 上限生效；重试耗尽后 BLOCKED(stuck)，绝不因"再试一次"而放行。
 * D-5：会话 compact —— ledger 在 ctx.storage（ADR-0006），与 session log 解耦，
 * 因此 compact 裁剪会话历史不会丢 gungnir 事件；冷重建结果与压缩前语义等价。
 */

function failingCommandContext(dir: string, exitCode: number): VerifyContext {
  return {
    workspaceRoot: dir,
    async runCommand(_command: string, _timeoutMs: number): Promise<CommandObservation> {
      return { exitCode, stdout: '', stderr: `simulated failure ${exitCode}` }
    },
    async readFile() {
      return null
    },
    async completeRubric() {
      throw new Error('d3 test: no llm')
    },
    now: () => Date.now(),
  }
}

function hooks(): EngineHooks & { directives: string[] } {
  const directives: string[] = []
  return {
    directives,
    injectDirective(_agentId, text) {
      directives.push(text)
    },
    log() {},
  }
}

function exitCodeSpec() {
  return {
    type: 'gungnir/spec' as const,
    spec: {
      specId: 'd3-spec',
      version: 1,
      objective: 'make the flaky command pass',
      successCriteria: [
        {
          id: 'c1',
          description: 'the flaky command exits 0',
          predicate: { kind: 'exit_code' as const, command: 'pwsh -Command "exit 0"', expectedExitCode: 0, timeoutMs: 60_000 },
          verifierLevel: 1 as const,
        },
      ],
      constraints: [], nonGoals: [], assumptions: [],
      budget: { maxRounds: null, maxVerifierRuns: null },
    },
  }
}

describe('D-3 tool execution failure', () => {
  it('retries the same signature, then BLOCKED(stuck) when retries are exhausted — never COMPLETE', async () => {
    const dir = tempWorkspace()
    const ledger = await AgentLedger.open(AGENT, new MemoryKv())
    const engine = new ReconcileEngine(
      { get: (agentId) => (agentId === AGENT ? ledger : undefined) },
      failingCommandContext(dir, 7),
      [new ExitCodeVerifier()],
      hooks(),
    )

    await ledger.append(exitCodeSpec())
    await engine.commitPlan(AGENT, [{ id: 's1', summary: 'run the flaky command', targetsCriteria: ['c1'] }], 'initial')

    // r1：首次失败（无历史签名）→ REPLAN，等模型重投影
    await engine.captureToolResult(AGENT, { callId: 'call-1', name: 'bash', content: [{ type: 'text', text: 'ran it' }], isError: false })
    await engine.recordClaim(AGENT, { summary: 'ran it', assertedOutcome: 'failed', evidenceRefs: [] })
    const afterR1 = ledger.current
    expect(afterR1.criteria['c1']?.lastRawOutcome).toBe('FAIL')
    const sig1 = afterR1.criteria['c1']?.lastFailSignature ?? ''
    expect(sig1).not.toBe('')
    expect(afterR1.phase).toBe('EXECUTING') // REPLAN

    // r2：同签名复发 → RETRY（引擎自动重提交同一 action）
    await engine.commitPlan(AGENT, [{ id: 's1', summary: 'retry the flaky command', targetsCriteria: ['c1'] }], 'retry after replan')
    await engine.captureToolResult(AGENT, { callId: 'call-2', name: 'bash', content: [{ type: 'text', text: 'ran it again' }], isError: false })
    await engine.recordClaim(AGENT, { summary: 'ran it again', assertedOutcome: 'failed', evidenceRefs: [] })
    const afterR2 = ledger.current
    expect(afterR2.criteria['c1']?.prevFailSignature).toBe(sig1)
    expect(afterR2.criteria['c1']?.lastFailSignature).toBe(sig1) // 同签名 → transient 判定成立
    expect(afterR2.currentRound).toBe(3) // RETRY 已自动 commit 下一轮
    // 手工重投影复用了同一 step id（=同一 actionId），与自动 RETRY 一样计入重试预算：
    // 重试预算不能靠"再投影一次"绕过。
    expect(afterR2.currentAction?.retried).toBe(2)

    // r3：重试次数耗尽 → BLOCKED stuck
    await engine.captureToolResult(AGENT, { callId: 'call-3', name: 'bash', content: [{ type: 'text', text: 'ran it a third time' }], isError: false })
    await engine.recordClaim(AGENT, { summary: 'ran it a third time', assertedOutcome: 'failed', evidenceRefs: [] })
    const final = ledger.current
    expect(final.phase).toBe('BLOCKED')
    expect(final.blocker).toBe('stuck')
    expect(final.criteria['c1']?.satisfied).toBe(false)
    expect(final.deterministicPassSeen).toBe(false)
    expect(final.verdictRuns).toBe(3)
  })
})

describe('D-5 session compaction', () => {
  it('keeps the ledger intact across a simulated compaction and rebuilds identically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gungnir-d5-'))
    const kvPath = join(dir, 'ledger.json')
    const sessionLogPath = join(dir, 'session.jsonl')

    // 会话 log（DSH 的持久权威）与 Gungnir ledger（ctx.storage）是两个载体
    writeFileSync(sessionLogPath, '{"seq":0,"type":"message"}\n'.repeat(50))

    const kv = FileKv.open(kvPath)
    const ledger = await AgentLedger.open(AGENT, kv)
    await ledger.append(exitCodeSpec())
    await ledger.append({
      type: 'gungnir/plan-projection',
      specId: 'd3-spec',
      projectionId: 'proj-1',
      steps: [{ id: 's1', summary: 'run the command', targetsCriteria: ['c1'], expectedEvidence: [] }],
      rationale: 'initial',
    })
    await ledger.append({ type: 'gungnir/commit', specId: 'd3-spec', round: 1, actionId: 's1', summary: 'run the command', targetsCriteria: ['c1'], expectedEvidence: [], projectionId: 'proj-1', stepId: 's1' })
    await ledger.append({ type: 'gungnir/evidence', specId: 'd3-spec', round: 1, evidenceId: 'ev-d5', source: 'tool_result', ref: 'call:x#tool:bash', digest: 'a'.repeat(64), preview: 'ok' })

    const before = ledger.current
    expect(before.eventsFolded).toBe(4)

    // 模拟 compact：会话历史被压缩/裁剪（Gungnir ledger 不在其中）
    writeFileSync(sessionLogPath, '{"seq":99,"type":"compaction-summary"}\n')
    expect(readFileSync(sessionLogPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(1)

    // 冷重建：ledger 不受影响
    const rebuilt = await AgentLedger.open(AGENT, FileKv.open(kvPath))
    expect(rebuilt.current.eventsFolded).toBe(before.eventsFolded)
    expect(rebuilt.current).toEqual(before)
    expect(rebuilt.current.phase).toBe('EXECUTING')
    expect(rebuilt.current.seenEvidenceIds.has('ev-d5')).toBe(true)

    // 重建后仍可继续追加（seq 不回退）
    await rebuilt.append({ type: 'gungnir/claim', specId: 'd3-spec', round: 1, actionId: 's1', summary: 'still fine', assertedOutcome: 'partial', evidenceRefs: [] })
    expect(rebuilt.current.claimsCount).toBe(1)
    expect(rebuilt.size).toBe(5)
  })
})
