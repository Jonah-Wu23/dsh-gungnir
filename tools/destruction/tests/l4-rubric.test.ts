import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VerifyContext } from 'gungnir-core'
import { AgentLedger, MemoryKv } from 'dsh-gungnir/ledger.js'
import { ReconcileEngine, type EngineHooks } from 'dsh-gungnir/engine.js'
import { LlmRubricVerifier } from 'dsh-gungnir/verifiers/llm-rubric.js'
import { tempWorkspace, AGENT } from './helpers.js'
import { describe, expect, it } from 'vitest'

/**
 * L4（llm_rubric）verifier 契约测试——用注入的 VerifyContext 替身代替网络，
 * 只验证判定逻辑本身（不是离线 mock 联调：被测对象是 verifier 纯逻辑，
 * 真机通道由 tools/destruction/llm-smoke.mjs 单独验证）。
 *
 * 覆盖 Plan §5 与铁律 4：
 * - 评审对象必须可定位（subjectPath），缺对象 = INCONCLUSIVE（fail loud，不凭空打分）；
 * - 对象越界/缺失 = INCONCLUSIVE（不伪造成功）；
 * - L4 的 PASS 经 core 生效判定降级为 PARTIAL → 单条 L4 criterion 推不出 COMPLETE。
 */

const RUBRIC = 'The subject must explicitly state that evidence, not claims, decides completion.'
const SUBJECT_OK = 'Gungnir decides completion from evidence — tool results, files and exit codes — never from a claim alone.'

function rubricContext(dir: string, see: (prompt: string) => void = () => {}): VerifyContext {
  return {
    workspaceRoot: dir,
    async runCommand() {
      throw new Error('l4 test: no command executor')
    },
    async readFile(path) {
      const { readFile } = await import('node:fs/promises')
      const { resolve, sep } = await import('node:path')
      const root = resolve(dir)
      const target = resolve(root, path)
      if (target !== root && !target.startsWith(root + sep)) return null
      return readFile(target, 'utf8').catch(() => null)
    },
    async completeRubric(prompt) {
      see(prompt)
      const hasSubject = prompt.includes('<<<SUBJECT') && prompt.includes(SUBJECT_OK)
      return JSON.stringify({
        score: hasSubject ? 0.95 : 0.1,
        rationale: hasSubject ? 'subject states the evidence rule explicitly' : 'no usable subject found',
      })
    },
    now: () => Date.now(),
  }
}

function criterion(subjectPath?: string) {
  return {
    id: 'c1',
    description: 'the rationale states the evidence rule',
    predicate: {
      kind: 'llm_rubric' as const,
      rubric: RUBRIC,
      passThreshold: 0.8,
      ...(subjectPath === undefined ? {} : { subjectPath }),
    },
    verifierLevel: 4 as const,
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

describe('L4 llm_rubric verifier: subject discipline', () => {
  it('returns INCONCLUSIVE when the predicate names no subject (never judges a vacuum)', async () => {
    const dir = tempWorkspace()
    const verifier = new LlmRubricVerifier()
    const result = await verifier.verify(criterion(), rubricContext(dir))
    expect(result.outcome).toBe('INCONCLUSIVE')
    expect(result.detailRef).toContain('no-subject')
    expect(result.evidence).toBeNull()
  })

  it('returns INCONCLUSIVE when the subject is missing or outside the fence', async () => {
    const dir = tempWorkspace()
    const verifier = new LlmRubricVerifier()
    const missing = await verifier.verify(criterion('nope/missing.md'), rubricContext(dir))
    expect(missing.outcome).toBe('INCONCLUSIVE')
    expect(missing.detailRef).toContain('subject-unreadable')

    const outside = await verifier.verify(criterion('../../outside.md'), rubricContext(dir))
    expect(outside.outcome).toBe('INCONCLUSIVE')
    expect(outside.detailRef).toContain('subject-unreadable')
  })

  it('judges the real subject and records a low-trust evidence locator', async () => {
    const dir = tempWorkspace()
    writeFileSync(join(dir, 'rationale.md'), SUBJECT_OK)
    let seenPrompt = ''
    const verifier = new LlmRubricVerifier()
    const result = await verifier.verify(criterion('rationale.md'), rubricContext(dir, (prompt) => {
      seenPrompt = prompt
    }))
    expect(seenPrompt).toContain('<<<SUBJECT')
    expect(seenPrompt).toContain(SUBJECT_OK)
    expect(result.outcome).toBe('PASS')
    expect(result.detailRef).toContain('(low trust)')
    expect(result.evidence?.source).toBe('env')
    expect(result.evidence?.preview).toContain('score=0.95')
  })
})

describe('L4 cannot carry a goal to COMPLETE (ladder rule, end to end through the engine)', () => {
  it('downgrades the L4 PASS to PARTIAL and never satisfies the criterion', async () => {
    const dir = tempWorkspace()
    writeFileSync(join(dir, 'rationale.md'), SUBJECT_OK)

    const ledger = await AgentLedger.open(AGENT, new MemoryKv())
    const engine = new ReconcileEngine(
      { get: (agentId) => (agentId === AGENT ? ledger : undefined) },
      rubricContext(dir),
      [new LlmRubricVerifier()],
      hooks(),
    )

    await ledger.append({
      type: 'gungnir/spec',
      spec: {
        specId: 'l4-spec',
        version: 1,
        objective: 'a rationale that states the evidence rule',
        successCriteria: [criterion('rationale.md')],
        constraints: [], nonGoals: [], assumptions: [],
        budget: { maxRounds: null, maxVerifierRuns: null },
      },
    })
    await engine.commitPlan(AGENT, [{ id: 's1', summary: 'write rationale', targetsCriteria: ['c1'] }], 'initial')
    await engine.captureToolResult(AGENT, {
      callId: 'call-l4',
      name: 'write',
      content: [{ type: 'text', text: SUBJECT_OK }],
      isError: false,
    })
    await engine.recordClaim(AGENT, { summary: 'done', assertedOutcome: 'done', evidenceRefs: [] })

    const state = ledger.current
    expect(state.criteria['c1']?.lastRawOutcome).toBe('PASS')
    expect(state.criteria['c1']?.lastOutcome).toBe('PARTIAL')
    expect(state.criteria['c1']?.satisfied).toBe(false)
    expect(state.deterministicPassSeen).toBe(false)
    expect(state.phase).not.toBe('COMPLETE')
    expect(state.phase).not.toBe('REVALIDATING')
  })
})
