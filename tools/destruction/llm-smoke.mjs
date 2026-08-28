/**
 * L4 rubric 真机冒烟（不是单测，不进 CI）：用自定义提供商的模型跑 LlmRubricVerifier
 * 与一整轮 ReconcileEngine，验证两件事：
 *   1. 真实 LLM 通道可用（prompt → schema 化 score/rationale → verdict + evidence）；
 *   2. 阶梯强制规则：L4 PASS 在 core 里降级为 PARTIAL → 单条 L4 criterion 永远
 *      推不出 COMPLETE（防假验收，Plan §5 / 铁律 4）。
 *
 * 用法（在仓库根有 .env 提供 APIKEY 时）：
 *   node tools/destruction/llm-smoke.mjs
 * 或显式给 key：
 *   GUNGNIR_API_KEY=sk_xxx node tools/destruction/llm-smoke.mjs
 *
 * .env 已加入 .gitignore；本脚本只读不写，也不把 key 打进日志。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { AgentLedger, MemoryKv } from 'dsh-gungnir/ledger.js'
import { ReconcileEngine } from 'dsh-gungnir/engine.js'
import { LlmRubricVerifier } from 'dsh-gungnir/verifiers/llm-rubric.js'

const BASE_URL = 'https://tokenrhythm.studio/v1'
const MODEL = 'deepseek-v4-flash-0731'
const AGENT = 'agent-llm-smoke'

function loadApiKey() {
  if (process.env['GUNGNIR_API_KEY']) return process.env['GUNGNIR_API_KEY']
  const envText = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  const match = envText.match(/APIKEY\s*=\s*(\S+)/)
  if (match === null) throw new Error('no API key: set GUNGNIR_API_KEY or put APIKEY=... in repo-root .env')
  return match[1]
}

const API_KEY = loadApiKey()

/** 最近一次模型原始回答（仅预览，便于排查 schema 解析问题）。 */
let lastRawAnswer = ''

async function completeRubric(prompt) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) {
    throw new Error(`rubric call failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  }
  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  lastRawAnswer = typeof content === 'string' ? content : ''
  return lastRawAnswer
}

// L4 必须评审一个真实、可定位的成果：临时 workspace 里的 rationale.md
const workspaceRoot = mkdtempSync(join(tmpdir(), 'gungnir-llm-smoke-'))
const SUBJECT_PATH = 'rationale.md'
const SUBJECT_TEXT =
  'An evidence-driven reconciler is harder to fool because the harness re-checks tool results, files and exit codes, while a self-reported summary is only a claim; a claim without evidence can never mark a goal completed.'
writeFileSync(join(workspaceRoot, SUBJECT_PATH), SUBJECT_TEXT)

const verifyContext = {
  workspaceRoot,
  async runCommand(command) {
    throw new Error(`smoke runCommand not used: ${command}`)
  },
  async readFile(path) {
    const { readFile } = await import('node:fs/promises')
    const root = resolve(workspaceRoot)
    const target = resolve(root, path)
    if (target !== root && !target.startsWith(root + sep)) return null
    return readFile(target, 'utf8').catch(() => null)
  },
  completeRubric,
  now: () => Date.now(),
}

const hooks = {
  injectDirective(agentId, text) {
    console.log(`[directive → ${agentId}] ${text}`)
  },
  log(level, message, detail) {
    console.log(`[${level}] ${message}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
  },
}

const CRITERION = {
  id: 'c1',
  description: 'The answer explains, in one sentence, why an evidence-driven reconciler is harder to fool than a self-reported summary.',
  predicate: {
    kind: 'llm_rubric',
    rubric: 'Must state that the harness checks external evidence (tool results/files/exit codes) instead of trusting the model\'s own claim, and mention that unverified claims cannot produce a completed goal.',
    passThreshold: 0.8,
    subjectPath: SUBJECT_PATH,
  },
  verifierLevel: 4,
}

async function directVerifierCase() {
  console.log('\n=== case 1: LlmRubricVerifier 直连真实模型 ===')
  const verifier = new LlmRubricVerifier()
  const result = await verifier.verify(CRITERION, verifyContext)
  console.log(`outcome        : ${result.outcome}`)
  console.log(`detailRef      : ${result.detailRef}`)
  console.log(`errorSignature : ${result.errorSignature || '(none)'}`)
  console.log(`evidence       : ${result.evidence === null ? 'null' : `${result.evidence.source} ${result.evidence.ref}`}`)
  console.log(`evidence.preview: ${result.evidence?.preview ?? '(none)'}`)
  console.log(`raw answer     : ${lastRawAnswer.slice(0, 300).replace(/\s+/g, ' ')}`)
  if (result.outcome === 'INCONCLUSIVE') {
    throw new Error('L4 verifier returned INCONCLUSIVE — the model channel or rubric parsing is broken (fail loud)')
  }
  return result
}

async function engineCase() {
  console.log('\n=== case 2: 一整轮 ReconcileEngine（claim ≠ evidence + 阶梯强制） ===')
  const ledger = await AgentLedger.open(AGENT, new MemoryKv())
  const directory = { get: (agentId) => (agentId === AGENT ? ledger : undefined) }
  const engine = new ReconcileEngine(directory, verifyContext, [new LlmRubricVerifier()], hooks)

  await ledger.append({
    type: 'gungnir/spec',
    spec: {
      specId: 'smoke-spec',
      version: 1,
      objective: 'produce and verify a one-sentence rationale',
      successCriteria: [CRITERION],
      constraints: [],
      nonGoals: [],
      assumptions: [],
      budget: { maxRounds: null, maxVerifierRuns: null },
    },
  })
  await engine.commitPlan(AGENT, [{ id: 's1', summary: 'write the rationale', targetsCriteria: ['c1'] }], 'initial projection')

  // harness 侧观测（等价于 tools/result 捕获）：模型真的写了东西
  await engine.captureToolResult(AGENT, {
    callId: 'call-smoke-1',
    name: 'write',
    content: [
      {
        type: 'text',
        text: 'An evidence-driven reconciler is harder to fool because the harness re-checks tool results, files and exit codes, while a self-reported summary is only a claim; a claim without evidence can never mark a goal completed.',
      },
    ],
    isError: false,
  })

  // 模型谎报/自评完成 —— 系统只把它当 claim
  await engine.recordClaim(AGENT, { summary: 'rationale written, all good', assertedOutcome: 'done', evidenceRefs: [] })

  const state = ledger.current
  const observed = state.criteria['c1']
  console.log(`phase           : ${state.phase}`)
  console.log(`currentRound    : ${state.currentRound}`)
  console.log(`claimsCount     : ${state.claimsCount} (claim 只是 claim)`)
  console.log(`verdictRuns     : ${state.verdictRuns}`)
  console.log(`raw outcome     : ${String(observed?.lastRawOutcome)}`)
  console.log(`effective outcome: ${String(observed?.lastOutcome)}  (L4 PASS 必须降级为 PARTIAL)`)
  console.log(`satisfied       : ${String(observed?.satisfied)} (必须 false)`)
  console.log(`deterministicPassSeen: ${String(state.deterministicPassSeen)} (必须 false)`)
  console.log(`blocker         : ${state.blocker || '(none)'}`)

  const problems = []
  if (observed?.lastRawOutcome === null) problems.push('no verdict was produced from the real LLM channel')
  if (observed?.lastOutcome === 'PASS') problems.push('L4 PASS was not downgraded to PARTIAL (ladder rule broken)')
  if (observed?.satisfied === true) problems.push('L4 alone marked the criterion satisfied')
  if (state.phase === 'COMPLETE') problems.push('a single L4 criterion reached COMPLETE (false acceptance)')
  if (state.deterministicPassSeen) problems.push('deterministicPassSeen set without any L1/L2 verdict')
  return problems
}

const directResult = await directVerifierCase()
const problems = await engineCase()

console.log('\n=== 结论 ===')
console.log(`model           : ${MODEL} @ ${BASE_URL}`)
console.log(`direct outcome  : ${directResult.outcome}`)
if (problems.length === 0) {
  console.log('断言全部通过：真机 L4 通道可用，且 L4 单独推不出 COMPLETE（防假验收成立）。')
} else {
  console.error('断言失败：')
  for (const problem of problems) console.error(` - ${problem}`)
  process.exitCode = 1
}
