/**
 * run-arch.mjs — SwitchBench A/B 架构的单任务 runner（Day 4 起使用）。
 *
 * 运行口径与 Day 1 Baseline 对齐（EXPERIMENT.md §10）：冻结 TASK_PROMPT（sha256
 * 一致）、冻结模型、600s 单任务 deadline（A/B 两阶段共享一个预算；冻结修正事故 #5）、工作区物料化
 * 到系统临时目录、run 后 Gate-1 冻结 verifier 判定 + 证据回拷。
 *
 * 用法：node src/run-arch.mjs --arch a|b --task t01 [--seed N] [--out <dir>]
 * 产物：<out>/<stamp>-<arch>-<taskId>/
 *   run.json / run.md / events.jsonl / payloads.jsonl / workspace 副本
 */
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { TASKS, TASK_PROMPT } from './tasks.mjs'
import { verifyWorkspace } from './verify.mjs'
import { materializeWorkspace, srcFootprint } from './run-common.mjs'
import { runArchitectureA, runArchitectureB } from './loops/architectures.mjs'
import { summarizeRun } from './metrics.mjs'
import { TASK_TIMEOUT_MS } from './deadline.mjs'

function parseArgs(argv) {
  const args = { arch: null, task: null, seed: 1001, out: null }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    if (key in args) args[key] = argv[i + 1]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
if (args.arch !== 'a' && args.arch !== 'b') {
  console.error('usage: node src/run-arch.mjs --arch a|b --task <taskId> [--seed N] [--out dir]')
  process.exit(2)
}
const task = TASKS.find((entry) => entry.id === args.task)
if (task === undefined) {
  console.error(`unknown task: ${args.task}; known: ${TASKS.map((entry) => entry.id).join(', ')}`)
  process.exit(2)
}
const seed = Number(args.seed)

const switchbenchRoot = fileURLToPath(new URL('..', import.meta.url))
const outRoot = args.out ?? join(switchbenchRoot, 'results', 'runs')
const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
const runDir = join(outRoot, `${runStamp}-${args.arch}-${task.id}`)
mkdirSync(runDir, { recursive: true })

// 工作区物料化在仓库外（系统临时目录），run 后回拷证据。
const tempRoot = mkdtempSync(join(tmpdir(), 'switchbench-ws-'))
const workspace = join(tempRoot, task.id)
const taskDir = join(switchbenchRoot, 'tasks', task.dir)
materializeWorkspace(taskDir, workspace)

// ---- 事件流与载荷存档 -------------------------------------------------------
const events = []
let startedAtMs = Date.now()
const eventSink = (event) => {
  events.push({ t: Date.now(), ...event })
}
const payloadWriter = (payload) => {
  appendFileSync(join(runDir, 'payloads.jsonl'), `${JSON.stringify(payload)}\n`, 'utf8')
}

console.log(`SwitchBench arch=${args.arch} task=${task.id} seed=${seed} (killer=${task.killer})`)
console.log(`workspace: ${workspace}`)
console.log(`prompt sha256: ${createHash('sha256').update(TASK_PROMPT).digest('hex').slice(0, 16)}…`)

startedAtMs = Date.now()
let outcome
let runError = null
try {
  const entrypoint = args.arch === 'a' ? runArchitectureA : runArchitectureB
  outcome = await entrypoint({
    workspace,
    onEvent: eventSink,
    onRequestPayload: payloadWriter,
    deadlineMs: TASK_TIMEOUT_MS,
    seed,
  })
} catch (error) {
  runError = error
}
const endedAtMs = Date.now()

if (runError !== null) {
  eventSink({ type: 'run-error', error: String(runError?.message ?? runError), timeout: runError?.driverTimeout === true })
  console.log(`run error: ${runError?.message ?? runError}${runError?.driverTimeout === true ? ' (deadline)' : ''}`)
}

// ---- Gate-1 冻结判定（不变，无论 run 是否报错）-----------------------------
let verifyResult
try {
  verifyResult = verifyWorkspace(workspace, taskDir)
} catch (error) {
  verifyResult = { verdict: 'ERROR', gates: {}, error: error instanceof Error ? error.message : String(error) }
}
const footprint = srcFootprint(workspace, taskDir)

// ---- 指标 ------------------------------------------------------------------
const metrics = summarizeRun(events, { startedAtMs, endedAtMs }, task.tests)
const vgcrPass = verifyResult.verdict === 'PASS'
// False Completion：run 正常收口（模型声明完成）但 verifier FAIL。
const falseCompletion = metrics.claimedCompletion && !vgcrPass && runError === null

const record = {
  architecture: args.arch,
  taskId: task.id,
  killer: task.killer,
  seed,
  runStamp,
  startedAt: new Date(startedAtMs).toISOString(),
  endedAt: new Date(endedAtMs).toISOString(),
  runError: runError === null ? null : String(runError?.message ?? runError),
  timedOut: runError?.driverTimeout === true,
  finishReason: outcome?.finishReason ?? null,
  finishSummary: outcome?.finishSummary?.slice(0, 2000) ?? null,
  packet: outcome?.packet ?? null,
  telemetry: outcome?.telemetry ?? null,
  metrics,
  verify: verifyResult,
  srcFootprint: footprint,
  vgcrPass,
  falseCompletion,
  promptSha256: createHash('sha256').update(TASK_PROMPT).digest('hex'),
  model: 'deepseek-v4-flash-0731 @ jiyuan-lvdong (frozen)',
  taskTimeoutMs: TASK_TIMEOUT_MS,
}

writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
writeFileSync(join(runDir, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8')

// 证据回拷（workspace 第一现场）。
cpSync(workspace, join(runDir, 'workspace'), { recursive: true })

const md = [
  `# SwitchBench run ${runStamp} — arch **${args.arch.toUpperCase()}** task \`${task.id}\` seed ${seed}`,
  '',
  `- finishReason: \`${record.finishReason ?? (record.timedOut ? 'timeout' : 'error')}\`；runError: \`${record.runError ?? 'none'}\``,
  `- Gate 1: **${verifyResult.verdict}**（probe=${verifyResult.gates?.bugNotReproducible?.ok ? 'clean' : 'repro'} / trunk=${verifyResult.gates?.trunkTestsPass ? `${verifyResult.gates.trunkTestsPass.counts?.pass ?? '-'}/${verifyResult.gates.trunkTestsPass.counts?.tests ?? '-'}` : 'n/a'} / integrity=${verifyResult.gates?.integrity?.ok} / exports=${verifyResult.gates?.exports?.ok}）`,
  `- 指标：wall=${(metrics.wallMs / 1000).toFixed(1)}s in=${metrics.inputTokens}tok out=${metrics.outputTokens}tok cached=${metrics.cachedTokens} rounds=${metrics.llmRoundTrips} tools=${metrics.toolCalls} waste=${(metrics.waste.ratio * 100).toFixed(0)}%`,
  `- TTFUA: ${metrics.ttfua === null ? 'n/a' : `${metrics.ttfua.seconds.toFixed(1)}s / ${metrics.ttfua.llmCallsBefore} rounds / ${metrics.ttfua.toolCallsBefore} tools before first useful action`}`,
  `- False Completion: ${falseCompletion}（claimed=${metrics.claimedCompletion}）`,
  `- src 足迹: changed=${JSON.stringify(footprint.changed)} added=${JSON.stringify(footprint.added)} deleted=${JSON.stringify(footprint.deleted)}`,
  outcome?.packet !== undefined && outcome?.packet !== null ? `- HandoffPacket: ${JSON.stringify(outcome.packet)}` : '',
  '',
  '```',
  (record.finishSummary ?? '(no finish summary)').trimEnd(),
  '```',
].filter((line) => line !== '').join('\n')
writeFileSync(join(runDir, 'run.md'), `${md}\n`, 'utf8')

console.log(`Gate1: ${verifyResult.verdict} | finish=${record.finishReason ?? 'n/a'} | wall=${(metrics.wallMs / 1000).toFixed(1)}s | in=${metrics.inputTokens} out=${metrics.outputTokens} | rounds=${metrics.llmRoundTrips} | tools=${metrics.toolCalls}`)
console.log(`run dir: ${runDir}`)
process.exit(vgcrPass ? 0 : 1)
