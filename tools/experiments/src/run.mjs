/**
 * 一阶段生死实验跑批（Plan §9.3 / 全阶段计划 §4.1 的 A3）。
 *
 * 每个任务都经**真实 headless profile + 真实模型**跑一遍完整 Gungnir 闭环
 * （spec → plan → commit → execute → claim → verdict → status），然后从
 * ctx.storage 的 ledger 冷重建状态，与人工 ground truth 对照。
 *
 * 指标：verdict 与 ground truth 一致率、假验收数（权重最高）、resume（冷重建）成功率、
 * evidence 覆盖率、轮次/verdict 开销。
 *
 * 用法：node src/run.mjs [taskId ...]   （不给参数 = 跑全部 20 个）
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// 直接吃两个包的 dist，避免本沙箱里 pnpm install 被 safe-delete 拦截
// （workspace 依赖仍声明在 package.json，CI/正常环境走正常安装）。
import { foldEvents } from '../../../packages/core/dist/index.js'
import { parseLedgerRecords } from '../../../packages/dsh-plugin/dist/ledger.js'
import { TASKS, buildPrompt } from './tasks.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const resultsDir = join(repoRoot, 'tools', 'experiments', 'results')
const ledgerPath = join(homedir(), '.dsh', 'storage', 'gungnir_ledger.json')

function loadApiKey() {
  if (process.env['JIYUAN_LVDONG_API_KEY']) return process.env['JIYUAN_LVDONG_API_KEY']
  const envText = readFileSync(join(repoRoot, '.env'), 'utf8')
  const match = envText.match(/APIKEY\s*=\s*(\S+)/)
  if (match === null) throw new Error('no API key: set JIYUAN_LVDONG_API_KEY or put APIKEY=... in repo-root .env')
  return match[1]
}

const API_KEY = loadApiKey()

function runTask(task) {
  const promptFile = join(resultsDir, `prompt-${task.id}.txt`)
  writeFileSync(promptFile, buildPrompt(task), 'utf8')
  // 提示：用 pwsh（已在 PATH 上，A1 里 pwsh 命令本身也在 harness 内跑通过）；
  // 回退到 Windows PowerShell 的完整路径。
  const psCommand = `$job = Get-Content -Raw -LiteralPath '${promptFile}'; dsh --profile headless $job`
  const candidates = [
    ['pwsh', ['-NoProfile', '-NonInteractive', '-Command', psCommand]],
    [join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand]],
  ]
  const started = Date.now()
  let result = { stdout: '', stderr: '', status: null }
  let lastError = ''
  for (const [bin, args] of candidates) {
    const attempt = spawnSync(bin, args, {
      cwd: repoRoot,
      env: { ...process.env, JIYUAN_LVDONG_API_KEY: API_KEY },
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    })
    const out = `${attempt.stdout ?? ''}${attempt.stderr ?? ''}`
    if (!attempt.error && out.includes('session-')) {
      result = attempt
      break
    }
    result = attempt
    lastError = attempt.error ? String(attempt.error.message) : out.slice(-300)
  }
  if (lastError !== '' && !(result.stdout ?? '').includes('session-')) {
    console.warn(`  (runner note: ${lastError})`)
  }
  const elapsedMs = Date.now() - started
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const sessionMatch = output.match(/session-[0-9a-f-]{8,}/)
  return { output, sessionId: sessionMatch === null ? null : sessionMatch[0], elapsedMs, exitCode: result.status }
}

function analyse(task, sessionId) {
  const raw = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  const tables = raw?.tables ?? {}
  const records = parseLedgerRecords(tables['events'] ?? {}, sessionId)
  const events = records.map((record) => record.event)
  // 冷重建两次：fold 的确定性与可恢复性就是 resume 成功率的度量口
  const state = foldEvents(events)
  const rebuilt = foldEvents(events)
  const rebuildStable = JSON.stringify(state) === JSON.stringify(rebuilt)

  const verdicts = events.filter((event) => event.type === 'gungnir/verdict')
  const evidences = events.filter((event) => event.type === 'gungnir/evidence')
  const claims = events.filter((event) => event.type === 'gungnir/claim')
  const evidenceRounds = new Set(evidences.map((event) => event.round))
  const backedVerdicts = verdicts.filter((verdict) => evidenceRounds.has(verdict.round)).length

  const criteria = {}
  for (const [id, criterionState] of Object.entries(state.criteria)) {
    criteria[id] = {
      raw: criterionState.lastRawOutcome,
      effective: criterionState.lastOutcome,
      satisfied: criterionState.satisfied,
      verdicts: criterionState.verdictCount,
    }
  }

  const completed = state.phase === 'COMPLETE'
  const expectedCompleted = task.expect === 'completed'
  const consistent = completed === expectedCompleted

  return {
    taskId: task.id,
    family: task.family,
    expect: task.expect,
    expectReason: task.expectReason,
    sessionId,
    phase: state.phase,
    rounds: state.currentRound,
    verdictRuns: state.verdictRuns,
    claims: state.claimsCount,
    evidenceCount: evidences.length,
    verdictCount: verdicts.length,
    evidenceCoverage: verdicts.length === 0 ? null : backedVerdicts / verdicts.length,
    deterministicPassSeen: state.deterministicPassSeen,
    blocker: state.blocker,
    criteria,
    rebuildStable,
    completed,
    consistent,
    falseAcceptance: !expectedCompleted && completed,
  }
}

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const selected = only.length === 0 ? TASKS : TASKS.filter((task) => only.includes(task.id))

mkdirSync(resultsDir, { recursive: true })
console.log(`running ${selected.length} tasks through the real headless profile (model: deepseek-v4-flash-0731)\n`)

const rows = []
for (const task of selected) {
  const startedAt = new Date().toISOString()
  const run = runTask(task)
  let row
  if (run.sessionId === null) {
    row = {
      taskId: task.id,
      family: task.family,
      expect: task.expect,
      phase: null,
      error: 'no gungnir session appeared in the run output',
      outputTail: run.output.slice(-800),
      elapsedMs: run.elapsedMs,
      consistent: false,
      falseAcceptance: false,
    }
  } else {
    try {
      row = { ...analyse(task, run.sessionId), elapsedMs: run.elapsedMs, startedAt }
    } catch (error) {
      row = {
        taskId: task.id,
        family: task.family,
        expect: task.expect,
        sessionId: run.sessionId,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: run.elapsedMs,
        consistent: false,
        falseAcceptance: false,
      }
    }
  }
  rows.push(row)
  const marker = row.consistent ? 'OK  ' : row.falseAcceptance ? 'LIE!' : 'MISS'
  console.log(
    `${marker} ${row.taskId.padEnd(4)} ${String(row.family).padEnd(22)} expect=${String(row.expect).padEnd(13)} phase=${String(row.phase ?? '-').padEnd(12)} rounds=${String(row.rounds ?? '-')} verdicts=${String(row.verdictCount ?? '-')} ${row.elapsedMs}ms`,
  )
  if (row.error !== undefined) console.log(`     error: ${row.error}`)
}

// ---- 汇总 -----------------------------------------------------------------------
const finished = rows.filter((row) => row.phase !== null || row.error === undefined)
const scored = rows.filter((row) => row.phase !== null && row.error === undefined)
const consistent = scored.filter((row) => row.consistent).length
const falseAcceptance = scored.filter((row) => row.falseAcceptance).length
const rebuildOk = scored.filter((row) => row.rebuildStable).length
const coverages = scored.map((row) => row.evidenceCoverage).filter((value) => typeof value === 'number')
const avgCoverage = coverages.length === 0 ? null : coverages.reduce((a, b) => a + b, 0) / coverages.length
const totalRounds = scored.reduce((sum, row) => sum + (row.rounds ?? 0), 0)
const totalVerdicts = scored.reduce((sum, row) => sum + (row.verdictCount ?? 0), 0)

const summary = {
  model: 'deepseek-v4-flash-0731 @ https://tokenrhythm.studio/v1',
  profile: 'headless (dsh --profile headless, gungnir plugin, autoApproveSpec)',
  tasksPlanned: selected.length,
  tasksScored: scored.length,
  consistency: scored.length === 0 ? null : consistent / scored.length,
  falseAcceptance,
  rebuildSuccessRate: scored.length === 0 ? null : rebuildOk / scored.length,
  evidenceCoverage: avgCoverage,
  totalRounds,
  totalVerdicts,
  generatedAt: new Date().toISOString(),
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const jsonPath = join(resultsDir, `experiment-${stamp}.json`)
writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2), 'utf8')

const md = [
  '# Gungnir 一阶段生死实验报告',
  '',
  `- 模型 / profile：${summary.model}；${summary.profile}`,
  `- 计划任务 ${summary.tasksPlanned}，可判定 ${summary.tasksScored}`,
  `- **verdict 与 ground truth 一致率：${summary.consistency === null ? 'n/a' : (summary.consistency * 100).toFixed(1) + '%'}**`,
  `- **假验收数：${summary.falseAcceptance}**（最高权重指标；期望 0）`,
  `- 冷重建（resume）成功率：${summary.rebuildSuccessRate === null ? 'n/a' : (summary.rebuildSuccessRate * 100).toFixed(1) + '%'}`,
  `- evidence 覆盖率：${summary.evidenceCoverage === null ? 'n/a' : (summary.evidenceCoverage * 100).toFixed(1) + '%'}`,
  `- 总轮次 ${summary.totalRounds}；总 verdict ${summary.totalVerdicts}`,
  '',
  '| task | family | expect | phase | rounds | verdicts | evidence | coverage | consistent |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((row) =>
    `| ${row.taskId} | ${row.family} | ${row.expect} | ${row.phase ?? 'ERROR'} | ${row.rounds ?? '-'} | ${row.verdictCount ?? '-'} | ${row.evidenceCount ?? '-'} | ${row.evidenceCoverage === undefined || row.evidenceCoverage === null ? '-' : (row.evidenceCoverage * 100).toFixed(0) + '%'} | ${row.consistent ? 'yes' : row.falseAcceptance ? 'FALSE-ACCEPT' : 'no'} |`,
  ),
  '',
  '原始 JSON：' + jsonPath.replace(repoRoot, '.'),
].join('\n')
const mdPath = join(resultsDir, `experiment-${stamp}.md`)
writeFileSync(mdPath, md, 'utf8')

console.log('\n=== 汇总 ===')
console.log(`一致率        : ${summary.consistency === null ? 'n/a' : (summary.consistency * 100).toFixed(1) + '%'} (${consistent}/${scored.length})`)
console.log(`假验收        : ${summary.falseAcceptance}`)
console.log(`冷重建成功率  : ${summary.rebuildSuccessRate === null ? 'n/a' : (summary.rebuildSuccessRate * 100).toFixed(1) + '%'}`)
console.log(`evidence 覆盖 : ${summary.evidenceCoverage === null ? 'n/a' : (summary.evidenceCoverage * 100).toFixed(1) + '%'}`)
console.log(`报告          : ${mdPath}`)
console.log(`原始数据      : ${jsonPath}`)

if (falseAcceptance > 0) process.exitCode = 1
