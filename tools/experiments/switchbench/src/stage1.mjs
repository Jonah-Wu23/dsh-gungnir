/**
 * stage1.mjs — SwitchBench Stage 1 跑批（EXPERIMENT.md §6：5 tasks × 1 seed × 3 架构）。
 *
 * 全矩阵在修正后的统一口径下全新执行（600s deadline，BENCHMARK.md §7 事故 #5）；
 * 顺序执行（EXPERIMENT.md §10 隔离纪律：单文件 ledger 同一时刻只跑一个 harness
 * 实例；A/B 不经 DSH，但保持顺序以控 API 并发）。Day 1 的 t01 Baseline 原样保留
 * 作历史证据，Stage 1 自行补跑其 baseline 行。
 *
 * Baseline 行经子进程调 run-baseline.mjs（一次一任务，产物 results/run-<ts>.json）
 * 并回收其行；A/B 行经 run-arch 同款路径进程内执行。
 * 汇总：results/stage1-<ts>.{json,md}（Gate 1/2/3 汇总表）。
 *
 * 用法：node src/stage1.mjs [--tasks t01,t02,...] [--seed 1001]
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { TASKS } from './tasks.mjs'
import { verifyWorkspace } from './verify.mjs'
import { runArchitectureA, runArchitectureB } from './loops/architectures.mjs'
import { summarizeRun, scoreTests } from './metrics.mjs'
import { decodeSessionLog, locateSessionLog, summarizeBaselineSession } from './baseline-log.mjs'
import { materializeWorkspace, srcFootprint } from './run-common.mjs'
import { TASK_TIMEOUT_MS } from './deadline.mjs'

const switchbenchRoot = fileURLToPath(new URL('..', import.meta.url))
const resultsDir = join(switchbenchRoot, 'results')

function parseArgs(argv) {
  const args = { tasks: null, seed: 1001, stageDir: null }
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--tasks') args.tasks = argv[i + 1]?.split(',')
    if (argv[i] === '--seed') args.seed = Number(argv[i + 1])
    if (argv[i] === '--stage-dir') args.stageDir = argv[i + 1]
  }
  return args
}
const args = parseArgs(process.argv.slice(2))
const tasks = args.tasks === null ? TASKS : TASKS.filter((task) => args.tasks.includes(task.id))
if (tasks.length === 0) {
  console.error('no tasks selected')
  process.exit(2)
}

// 断点续跑：--stage-dir 指向既有 stage 目录时，跳过 rows.jsonl 里已完成的
// (task, arch) 对（跑批被中断后重入，已烧的 run 不重烧）。
const stageStamp = args.stageDir !== null ? (args.stageDir.match(/stage1-(.+)$/)?.[1] ?? new Date().toISOString().replace(/[:.]/g, '-')) : new Date().toISOString().replace(/[:.]/g, '-')
const stageDir = args.stageDir ?? join(resultsDir, `stage1-${stageStamp}`)
mkdirSync(stageDir, { recursive: true })
const rowsLogPath = join(stageDir, 'rows.jsonl')
const priorRows = []
if (existsSync(rowsLogPath)) {
  for (const line of readFileSync(rowsLogPath, 'utf8').split('\n').filter((line) => line.trim() !== '')) {
    priorRows.push(JSON.parse(line))
  }
}
const done = new Set(priorRows.map((row) => `${row.taskId}:${row.architecture}`))
console.log(`=== SwitchBench Stage 1: ${tasks.map((task) => task.id).join(', ')} × [baseline, a, b] × seed ${args.seed} (budget ${TASK_TIMEOUT_MS / 1000}s) ===`)
if (priorRows.length > 0) console.log(`resume: ${priorRows.length} rows already recorded in ${rowsLogPath}`)

// ---- Baseline runner（子进程，回收 run-<ts>.json 的行）-----------------------

function runBaselineRow(task) {
  const before = new Set(existsSync(resultsDir) ? readdirSync(resultsDir).filter((name) => /^run-.*\.json$/.test(name)) : [])
  const child = spawnSync(process.execPath, [join(switchbenchRoot, 'src', 'run-baseline.mjs'), task.id], {
    cwd: switchbenchRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const interesting = (child.stdout ?? '').split('\n').filter((line) => /^(result:|Gate1|SwitchBench Baseline run)/.test(line) || line.includes('violation:'))
  console.log(interesting.join('\n'))
  if (child.status !== 0) {
    console.log(`(baseline runner exit ${child.status}; stderr tail: ${(child.stderr ?? '').slice(-300)})`)
  }
  const fresh = readdirSync(resultsDir).filter((name) => /^run-.*\.json$/.test(name) && !before.has(name))
  if (fresh.length !== 1) {
    return { taskId: task.id, architecture: 'baseline', runError: `expected 1 fresh run file, got ${fresh.length}: ${fresh.join(', ')}` }
  }
  const row = JSON.parse(readFileSync(join(resultsDir, fresh[0]), 'utf8')).rows.find((entry) => entry.taskId === task.id)
  return { ...row, architecture: 'baseline' }
}

// ---- A/B runner（进程内，事件/载荷/工作区证据落 stage 目录）-------------------

async function runArchRow(arch, task, seed) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'switchbench-ws-'))
  const workspace = join(tempRoot, task.id)
  materializeWorkspace(join(switchbenchRoot, 'tasks', task.dir), workspace)

  const events = []
  const startedAtMs = Date.now()
  const payloadPath = join(stageDir, `payloads-${arch}-${task.id}.jsonl`)
  const entrypoint = arch === 'a' ? runArchitectureA : runArchitectureB
  let outcome = null
  let runError = null
  try {
    outcome = await entrypoint({
      workspace,
      onEvent: (event) => events.push({ t: Date.now(), ...event }),
      onRequestPayload: (payload) => appendFileSync(payloadPath, `${JSON.stringify(payload)}\n`, 'utf8'),
      deadlineMs: TASK_TIMEOUT_MS,
      seed,
    })
  } catch (error) {
    runError = error
  }
  const endedAtMs = Date.now()
  if (runError !== null) events.push({ t: endedAtMs, type: 'run-error', error: String(runError?.message ?? runError), timeout: runError?.driverTimeout === true })

  let verifyResult
  try {
    verifyResult = verifyWorkspace(workspace, taskDirFor(task))
  } catch (error) {
    verifyResult = { verdict: 'ERROR', gates: {}, error: error instanceof Error ? error.message : String(error) }
  }
  const footprint = srcFootprint(workspace, taskDirFor(task))
  const metrics = summarizeRun(events, { startedAtMs, endedAtMs }, task.tests)
  const vgcrPass = verifyResult.verdict === 'PASS'
  cpSync(workspace, join(stageDir, `workspace-${arch}-${task.id}`), { recursive: true })
  writeFileSync(join(stageDir, `events-${arch}-${task.id}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8')

  return {
    taskId: task.id,
    killer: task.killer,
    architecture: arch,
    seed,
    startedAt: new Date(startedAtMs).toISOString(),
    elapsedMs: endedAtMs - startedAtMs,
    timedOut: runError?.driverTimeout === true,
    runError: runError === null ? null : String(runError?.message ?? runError),
    finishReason: outcome?.finishReason ?? null,
    packet: outcome?.packet ?? null,
    telemetry: outcome?.telemetry ?? null,
    verify: verifyResult,
    srcFootprint: footprint,
    vgcrPass,
    falseCompletion: metrics.claimedCompletion && !vgcrPass && runError === null,
    metrics,
  }
}

function taskDirFor(task) {
  return join(switchbenchRoot, 'tasks', task.dir)
}

// ---- 矩阵执行（顺序；行完成即落 rows.jsonl，中断可续）------------------------

const rows = [...priorRows]
for (const task of tasks) {
  console.log(`\n--- ${task.id} ${task.killer ? '(KILLER)' : ''} ${task.title}`)
  for (const arch of ['baseline', 'a', 'b']) {
    if (done.has(`${task.id}:${arch}`)) {
      console.log(`  [${arch}] already recorded, skip`)
      continue
    }
    const started = Date.now()
    let row
    if (arch === 'baseline') {
      row = runBaselineRow(task)
      if (row.metrics === undefined) row = { ...row, ...decorateBaselineRow(row, task) }
    } else {
      row = await runArchRow(arch, task, args.seed)
    }
    rows.push(row)
    appendFileSync(rowsLogPath, `${JSON.stringify(row)}\n`, 'utf8')
    const gate = row.verify?.verdict ?? 'ERROR'
    const wall = ((row.metrics?.wallMs ?? row.elapsedMs ?? 0) / 1000).toFixed(1)
    const tokens = row.metrics?.inputTokens !== null && row.metrics?.inputTokens !== undefined
      ? `${row.metrics.inputTokens} in / ${row.metrics.outputTokens} out`
      : 'tokens n/a (session-log口径)'
    console.log(`  [${arch}] Gate1=${gate} wall=${wall}s ${tokens} (${((Date.now() - started) / 1000).toFixed(0)}s incl. verify)`)
  }
}

// ---- Baseline 指标补全（session log 复盘，Gate 2/3 降级口径）------------------

function decorateBaselineRow(row, task) {
  let sessionMetrics = null
  try {
    if (row.sessionId) {
      const logPath = locateSessionLog(row.sessionId)
      if (logPath !== null) {
        sessionMetrics = summarizeBaselineSession(decodeSessionLog(logPath))
      }
    }
  } catch (error) {
    sessionMetrics = { error: String(error?.message ?? error) }
  }
  if (sessionMetrics === null) return { metrics: null, falseCompletion: false }
  if (sessionMetrics.error !== undefined) return { metrics: sessionMetrics, falseCompletion: false }
  const scores = scoreTests(sessionMetrics.tests.executed, task.tests)
  return {
    metrics: { ...sessionMetrics, tests: { ...sessionMetrics.tests, scores } },
    falseCompletion: sessionMetrics.claimedCompletion === true && row.vgcrPass === false,
  }
}

// ---- 汇总与落盘 --------------------------------------------------------------

const summary = summarizeStage(rows)
writeFileSync(join(stageDir, `stage1-${stageStamp}.json`), `${JSON.stringify({ stage: '1', stamp: stageStamp, seed: args.seed, budgetMs: TASK_TIMEOUT_MS, rows, summary }, null, 2)}\n`, 'utf8')
writeFileSync(join(stageDir, `stage1-${stageStamp}.md`), renderStageMarkdown(stageStamp, rows, summary), 'utf8')
console.log(`\n=== Stage 1 汇总 ===`)
console.log(`dir: ${stageDir}`)
console.log(renderSummaryText(summary))

function avg(values) {
  const list = values.filter((value) => value !== null && value !== undefined && Number.isFinite(value))
  return list.length === 0 ? null : list.reduce((sum, value) => sum + value, 0) / list.length
}

function summarizeStage(rows) {
  const byArch = {}
  for (const arch of ['baseline', 'a', 'b']) {
    const archRows = rows.filter((row) => row.architecture === arch)
    const pass = archRows.filter((row) => row.vgcrPass === true).length
    const metricRows = archRows.filter((row) => row.metrics && row.metrics.wallMs !== null && row.metrics.wallMs !== undefined)
    const perSuccess = metricRows.filter((row) => row.vgcrPass === true)
    byArch[arch] = {
      vgcr: archRows.length === 0 ? null : pass / archRows.length,
      pass,
      total: archRows.length,
      falseCompletion: archRows.filter((row) => row.falseCompletion === true).length,
      timeouts: archRows.filter((row) => row.timedOut === true).length,
      avgWallS: avg(metricRows.map((row) => row.metrics.wallMs / 1000)),
      avgInputTokens: avg(metricRows.map((row) => row.metrics.inputTokens)),
      avgOutputTokens: avg(metricRows.map((row) => row.metrics.outputTokens)),
      avgLlmRounds: avg(metricRows.map((row) => row.metrics.llmRoundTrips)),
      avgToolCalls: avg(metricRows.map((row) => row.metrics.toolCalls)),
      avgWasteRatio: avg(metricRows.map((row) => row.metrics.waste?.ratio)),
      avgTtfuaS: avg(metricRows.map((row) => row.metrics.ttfua?.seconds)),
      avgTestRecall: avg(metricRows.map((row) => row.metrics.tests?.scores?.recall)),
      avgTestPrecision: avg(metricRows.map((row) => row.metrics.tests?.scores?.precision)),
      inputPerSuccess: avg(perSuccess.map((row) => row.metrics.inputTokens)),
      wallPerSuccessS: avg(perSuccess.map((row) => row.metrics.wallMs / 1000)),
      roundsPerSuccess: avg(perSuccess.map((row) => row.metrics.llmRoundTrips)),
    }
  }
  return { byArch }
}

function fmt(value, digits = 2) {
  return value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits)
}

function renderSummaryText(summary) {
  const lines = ['| arch | VGCR | pass | falseCompl | timeout | wall/s | in tok | rounds | tools | waste | ttfua/s | recall | precision |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
  for (const [arch, s] of Object.entries(summary.byArch)) {
    lines.push(`| ${arch} | ${fmt(s.vgcr)} | ${s.pass}/${s.total} | ${s.falseCompletion} | ${s.timeouts} | ${fmt(s.avgWallS, 1)} | ${fmt(s.avgInputTokens, 0)} | ${fmt(s.avgLlmRounds, 1)} | ${fmt(s.avgToolCalls, 1)} | ${fmt(s.avgWasteRatio)} | ${fmt(s.avgTtfuaS, 1)} | ${fmt(s.avgTestRecall)} | ${fmt(s.avgTestPrecision)} |`)
  }
  return lines.join('\n')
}

function renderStageMarkdown(stageStamp, rows, summary) {
  return [
    `# SwitchBench Stage 1 \`${stageStamp}\`（${rows.length} runs：${tasks.length} tasks × 1 seed × 3 arch，600s 统一预算）`,
    '',
    renderSummaryText(summary),
    '',
    '## 单 run 明细',
    '',
    '| task | arch | Gate1 | finish | wall s | in tok | out tok | rounds | tools | waste | src changed |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => {
      const m = row.metrics ?? {}
      const wall = m.wallMs !== null && m.wallMs !== undefined ? (m.wallMs / 1000).toFixed(1) : ((row.elapsedMs ?? 0) / 1000).toFixed(1)
      return `| ${row.taskId} | ${row.architecture} | ${row.verify?.verdict ?? 'ERROR'} | ${row.timedOut ? 'timeout' : row.finishReason ?? row.runError ?? 'n/a'} | ${wall} | ${m.inputTokens ?? 'n/a'} | ${m.outputTokens ?? 'n/a'} | ${m.llmRoundTrips ?? 'n/a'} | ${m.toolCalls ?? 'n/a'} | ${m.waste?.ratio !== undefined && m.waste?.ratio !== null ? m.waste.ratio.toFixed(2) : 'n/a'} | ${row.srcFootprint?.changed?.length ?? 'n/a'} |`
    }),
    '',
    '## HandoffPacket（B 组）',
    '',
    ...rows
      .filter((row) => row.architecture === 'b' && row.packet !== null && row.packet !== undefined)
      .map((row) => `### ${row.taskId}\n\n\`\`\`json\n${JSON.stringify(row.packet, null, 2)}\n\`\`\``),
    '',
    '原始 JSON：本目录 stage1 JSON 文件；事件流 payloads/events JSONL 同目录。',
  ].join('\n') + '\n'
}
