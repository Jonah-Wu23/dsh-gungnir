/**
 * stack/medicines.mjs — H-VE 药方执行面（M3；决策逻辑在 @gungnir/core 纯函数，本文件
 * 只做 runner 侧执行接线：probe 构造、replay 覆盖层、spawnSync 运行）。
 *
 * 纪律（PRE-REGISTRATION §5/计划 §7）：全部在 verifier/evidence 层，零 loop 侵入；
 * 验证命令一律 runner 侧构造 + spawnSync（cmd 语义），禁止 shell 字符串拼接
 * （probe 一律写成文件再 node 跑，不走 `node -e "<…>"` 引号地狱——ADR-0018 §2 教训）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
} from '../../../../packages/core/dist/ve.js'

const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const coreVeUrl = pathToFileURL(join(repoRoot, 'packages', 'core', 'dist', 've.js')).href
const HIDDEN_SEED = 20_260_830 // 冻结：隐藏输入生成种子（可复现）

function runExit(command, cwd, timeoutMs = 120_000) {
  const result = spawnSync(command, { shell: true, cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.error !== undefined) return { exitCode: null, error: result.error.message }
  return { exitCode: result.status ?? null, error: null }
}

// ---- M-A：trunk-path 模板 probe 构造（runner 侧） ---------------------------------

function pricingProbe(workspace) {
  // 模板：定价管线整单一次舍入。probe 导入 workspace 公开 API + core 参考检查，
  // 用隐藏 cart（结构化判别对 + 种子随机）走同一公开 API。
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

/** M-A：判据表达从"跑可见测试"升级为"公开 API + harness 构造输入"。 */
async function applyMA({ workspace, supplied }) {
  const api = supplied.api
  if (api === undefined) return { applied: false }
  let probe
  if (api.template === 'pricing-round-once') probe = pricingProbe(workspace)
  else if (api.template === 'pipeline-validation') probe = pipelineProbe(workspace)
  else return { applied: false, reason: `unknown trunk template: ${api.template}` }
  writeFileSync(join(workspace, '.ve-trunk-probe.mjs'), probe, 'utf8')
  const result = spawnSync(process.execPath, ['.ve-trunk-probe.mjs'], { cwd: workspace, encoding: 'utf8', timeout: 120_000, windowsHide: true })
  let parsed
  try {
    parsed = JSON.parse(result.stdout ?? '')
  } catch {
    parsed = { ok: false, failures: [`trunk probe output unparsable (exit ${result.status})`] }
  }
  return { applied: true, ok: parsed.ok === true, failures: parsed.failures ?? [] }
}

// ---- M-B：判别性证据规则（replay 到原始 buggy 状态） --------------------------------

/** 构造 buggy 状态：交付物 workspace 复制 + buggyRef 覆盖层（path）或原样（workspace）。 */
function buildBuggyWorkspace(workspace, fixtureDir, buggyRef) {
  const buggyTmp = mkdtempSync(join(tmpdir(), 've-buggy-'))
  cpSync(workspace, buggyTmp, { recursive: true })
  if (buggyRef.type === 'path') {
    const overlay = join(fixtureDir, buggyRef.path)
    if (!existsSync(overlay)) throw new Error(`buggy overlay not found: ${overlay}`)
    cpSync(overlay, buggyTmp, { recursive: true })
  }
  return buggyTmp
}

async function applyMB({ workspace, fixtureDir, supplied }) {
  const replay = supplied.replay
  if (replay === undefined) return { applied: false }
  const classes = []
  const details = []
  for (const evidence of replay.evidence) {
    const buggyTmp = buildBuggyWorkspace(workspace, fixtureDir, replay.buggyRef)
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

// ---- M-C：UNVERIFIABLE 三态 -------------------------------------------------------

function applyMC({ supplied }) {
  const unverifiable = supplied.unverifiableCriteria ?? []
  const result = adjudicateUnverifiable(unverifiable)
  return { applied: result.handled, ...result }
}

// ---- M-D：grounding 证据检查 -------------------------------------------------------

function applyMD({ workspace, fixtureDir, supplied }) {
  const grounding = supplied.grounding
  if (grounding === undefined) return { applied: false }
  const toolLogPath = join(fixtureDir, supplied.toolLog ?? '')
  if (!existsSync(toolLogPath)) {
    return { applied: true, violations: [`tool-log not found: ${supplied.toolLog}`] }
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
