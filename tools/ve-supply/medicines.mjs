/**
 * ve-supply/medicines.mjs — 治疗臂药方执行面（供给闭环版）。
 *
 * 来源：tools/experiments/ve-bench/stack/medicines.mjs（M3，冻结实验资产，未改动）。
 * 差异点（如实随档代码重复）：
 * - M-B 的 buggy 基底从"夹具 overlay（buggyRef.type='path'）"改为"git 快照提取
 *   （buggyRef.type='git'，snapshot.mjs 产物）"——派发契约的真实来源；
 * - M-D 的 tool-log 从"夹具目录路径"改为"显式传入的 tool-log 路径"（toollog.mjs
 *   从真实 session log 提取）；
 * - 决策逻辑仍全部在 @gungnir/core 纯函数（ve.ts / contract.ts）。
 *
 * 纪律（沿袭 ve-bench）：验证命令一律 runner 侧构造 + spawnSync（cmd 语义），
 * probe 一律写成文件再 node 跑，不走引号地狱（ADR-0018 §2 教训）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import {
  adjudicateUnverifiable,
  checkGrounding,
  checkPipelineValidation,
  checkPricingRoundOnce,
  classifyReplayEvidence,
  completionEvidenceOk,
  generateHiddenCarts,
  generateHiddenRows,
} from '../../packages/core/dist/ve.js'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const coreVeUrl = pathToFileURL(join(repoRoot, 'packages', 'core', 'dist', 've.js')).href
const HIDDEN_SEED = 20_260_830 // 冻结：隐藏输入生成种子（可复现，同 seed 同题）

function runExit(command, cwd, timeoutMs = 120_000) {
  const result = spawnSync(command, { shell: true, cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.error !== undefined) return { exitCode: null, error: result.error.message }
  return { exitCode: result.status ?? null, error: null }
}

// ---- M-A：trunk-path 模板 probe 构造（runner 侧；与 ve-bench 同构） -----------------

function pricingProbe(workspace) {
  return [
    "import { checkoutTotal } from './src/checkout.js'",
    `import { generateHiddenCarts, checkPricingRoundOnce } from ${JSON.stringify(coreVeUrl)}`,
    `const inputs = generateHiddenCarts(${HIDDEN_SEED})`,
    'const failures = []',
    'for (const cart of inputs) {',
    '  let actual',
    '  try { actual = checkoutTotal(cart.lines, cart.rate) } catch (error) { failures.push(`hidden cart threw: ${error?.message ?? error}`); continue }',
    '  failures.push(...checkPricingRoundOnce(actual, cart.lines, cart.rate))',
    '}',
    'console.log(JSON.stringify({ ok: failures.length === 0, failures }))',
    'process.exit(failures.length === 0 ? 0 : 1)',
  ].join('\n')
}

function pipelineProbe(workspace) {
  return [
    "import { exportPipeline } from './src/pipeline.js'",
    `import { generateHiddenRows, checkPipelineValidation } from ${JSON.stringify(coreVeUrl)}`,
    `const rows = generateHiddenRows(${HIDDEN_SEED})`,
    'let result',
    'try { result = exportPipeline(rows) } catch (error) { console.log(JSON.stringify({ ok: false, failures: [`probe threw: ${error?.message ?? error}`] })); process.exit(1) }',
    'const failures = checkPipelineValidation(result, rows)',
    'console.log(JSON.stringify({ ok: failures.length === 0, failures }))',
    'process.exit(failures.length === 0 ? 0 : 1)',
  ].join('\n')
}

// ---- M5 新增模板（M5 计划 §3，M-A 模板库扩容） ------------------------------------

/** ledger-reentry：事件溯源 × 钩子重入（T1）。probe 经公开 API 跑固定对抗场景，
 *  断言每个前缀无透支 + 终局守恒 + 快照读 == fold 重算（core 纯函数）。 */
function ledgerReentryProbe(workspace) {
  return [
    "import { createLedger, transfer, getBalance, createRebateHook } from './src/index.js'",
    `import { generateLedgerReentryScenario, checkLedgerReentry } from ${JSON.stringify(coreVeUrl)}`,
    'const scenario = generateLedgerReentryScenario()',
    'const ledger = createLedger()',
    'for (const fund of scenario.fund) ledger.append({ type: "credit", account: fund.account, amountCents: fund.amountCents, ts: 0, id: "fund-" + fund.account })',
    'const hook = createRebateHook(ledger, scenario.rebatePercent)',
    'const failures = []',
    'for (const t of scenario.transfers) {',
    '  try { transfer(ledger, t.from, t.to, t.amountCents, { onSettled: hook, clock: () => 1 }) } catch (error) { failures.push(`transfer threw: ${error?.message ?? error}`) }',
    '}',
    'const balances = {}',
    'for (const account of scenario.accounts) balances[account] = getBalance(ledger, account)',
    'const initial = scenario.fund.reduce((sum, fund) => sum + fund.amountCents, 0)',
    'failures.push(...checkLedgerReentry(ledger.events(), balances, initial))',
    'console.log(JSON.stringify({ ok: failures.length === 0, failures }))',
    'process.exit(failures.length === 0 ? 0 : 1)',
  ].join('\n')
}

/** effectively-once：重试 × 去重 × 保序三体（T2）。probe 经生产入口灌对抗序列
 *  （注入失败 + 时钟跨窗口 + 同 key 连续），断言导出 exactly-once 且 per-key 有序。 */
function effectivelyOnceProbe(workspace) {
  return [
    "import { createQueue, createDedup, createPump, createSink } from './src/index.js'",
    `import { checkEffectivelyOnce, checkPerKeyOrder } from ${JSON.stringify(coreVeUrl)}`,
    'const queue = createQueue()',
    'const sink = createSink()',
    'let now = 0',
    'const clock = { now: () => now }',
    'queue.enqueue({ id: "m1", key: "K", payload: 1 })',
    'queue.enqueue({ id: "m2", key: "K", payload: 2 })',
    'let failures = 1',
    'const pump = createPump({ queue, dedup: createDedup({ windowMs: 500 }), sink, clock, processMessage: () => (failures-- > 0 ? false : true), maxAttempts: 3 })',
    'pump.run(1)',
    'now = 200',
    'pump.run(100)',
    'const delivered = sink.deliveredIds().map((id) => ({ id, key: "K" }))',
    'const problems = [...checkEffectivelyOnce(delivered), ...checkPerKeyOrder(delivered, { K: ["m1", "m2"] })]',
    'console.log(JSON.stringify({ ok: problems.length === 0, failures: problems }))',
    'process.exit(problems.length === 0 ? 0 : 1)',
  ].join('\n')
}

/** M-A：判据表达从"跑可见测试"升级为"公开 API + harness 构造输入"。 */
async function applyMA({ workspace, supplied }) {
  const api = supplied.api
  if (api === undefined) return { applied: false }
  let probe
  if (api.template === 'pricing-round-once') probe = pricingProbe(workspace)
  else if (api.template === 'pipeline-validation') probe = pipelineProbe(workspace)
  else if (api.template === 'ledger-reentry') probe = ledgerReentryProbe(workspace)
  else if (api.template === 'effectively-once') probe = effectivelyOnceProbe(workspace)
  else return { applied: false, reason: `unknown trunk template: ${api.template}` }
  const probePath = join(workspace, '.ve-trunk-probe.mjs')
  writeFileSync(probePath, probe, 'utf8')
  let parsed
  try {
    const result = spawnSync(process.execPath, ['.ve-trunk-probe.mjs'], { cwd: workspace, encoding: 'utf8', timeout: 120_000, windowsHide: true })
    try {
      parsed = JSON.parse(result.stdout ?? '')
    } catch {
      parsed = { ok: false, failures: [`trunk probe output unparsable (exit ${result.status})`] }
    }
  } finally {
    // 工作区卫生：probe 是 harness 临时注入物，跑完即删，不留入交付物
    rmSync(probePath, { force: true })
  }
  return { applied: true, ok: parsed.ok === true, failures: parsed.failures ?? [] }
}

// ---- M-B：判别性证据规则（replay 到 git 快照的 buggy 基底） ------------------------

/** 构造 buggy 状态：git 快照目录直接作为 buggy 基底（snapshot.mjs 产物）。 */
function buildBuggyWorkspace(workspace, buggyBaseDir) {
  const buggyTmp = mkdtempSync(join(tmpdir(), 've-supply-buggy-'))
  cpSync(buggyBaseDir, buggyTmp, { recursive: true })
  return buggyTmp
}

async function applyMB({ workspace, supplied, buggyBaseDir }) {
  const replay = supplied.replay
  if (replay === undefined) return { applied: false }
  const classes = []
  const details = []
  for (const evidence of replay.evidence) {
    const buggyTmp = buildBuggyWorkspace(workspace, buggyBaseDir)
    const buggy = runExit(evidence.command, buggyTmp, evidence.timeoutMs)
    const fixed = runExit(evidence.command, workspace, evidence.timeoutMs)
    const buggyOk = buggy.exitCode === evidence.expectedExitCode
    const fixedOk = fixed.exitCode === evidence.expectedExitCode
    const cls = classifyReplayEvidence(buggyOk, fixedOk)
    classes.push(cls)
    details.push(`${evidence.id}: buggy=${buggyOk ? 'PASS' : 'FAIL'} fixed=${fixedOk ? 'PASS' : 'FAIL'} → ${cls}`)
    rmSync(buggyTmp, { recursive: true, force: true })
  }
  const ok = completionEvidenceOk(classes)
  return { applied: true, ok, classes, details }
}

// ---- M-C：UNVERIFIABLE 三态 ---------------------------------------------------------

function applyMC({ supplied }) {
  const unverifiable = supplied.unverifiableCriteria ?? []
  const result = adjudicateUnverifiable(unverifiable)
  return { applied: result.handled, ...result }
}

// ---- M-D：grounding 证据检查（tool-log 显式传入，toollog.mjs 产物） ------------------

function applyMD({ supplied, toolLogPath }) {
  const grounding = supplied.grounding
  if (grounding === undefined) return { applied: false }
  if (toolLogPath === undefined || toolLogPath === '') {
    return { applied: true, violations: ['tool-log not provided (session log missing)'] }
  }
  const events = readFileSync(toolLogPath, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
  const violations = checkGrounding(events, grounding.dependencies)
  return { applied: true, violations }
}

export const MEDICINES = { 'M-A': applyMA, 'M-B': applyMB, 'M-C': applyMC, 'M-D': applyMD }
