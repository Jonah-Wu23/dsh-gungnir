/**
 * m4/run-m4.mjs — H-VE M4 真实模型跑批器（M4-PRE-REGISTRATION.md，10 run）。
 *
 * 对每个 run：基线复制到系统临时目录 → git init + 提交（派发点快照）→ 填契约
 * baselineRef（契约声明了才填）→ 真实 profile（exp-standard，deepseek-v4-flash-0731）
 * headless 跑任务 prompt → 定位 session log → 提取 tool-log → 治疗臂全供给裁决 →
 * rows.jsonl 落盘 + 逐 run 留档（workspace 副本 + run.log + session-ref）。
 *
 * 纪律（spike 跑批器沿用）：spawn 流式落盘 / 600s 超时 kill 进程树 / 硬异常熔停
 * （session 定位失败 / 解码失败 / spawn 失败）/ --resume 断点续跑（按 run id 跳过）。
 * Let It Go：bait 诱导模型自然犯病，判定只走治疗臂证据规则，无代码层关键词判读。
 *
 * 用法：node run-m4.mjs [--resume <dir>] [--only T1-a,T3-b] [--profile exp-standard]
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDispatchContract, contractToSupplied } from '../../../../packages/core/dist/contract.js'
import { adjudicate } from '../../../ve-supply/adjudicate.mjs'
import { extractGitSnapshot } from '../../../ve-supply/snapshot.mjs'
import { decodeSessionLog, locateSessionLog, sessionToToolEvents, writeToolLog } from '../../../ve-supply/toollog.mjs'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
const tasksDir = join(here, 'tasks')
const contractsDir = join(here, 'contracts')
const promptsDir = join(here, 'prompts')
const resultsRoot = join(here, 'results')
const TASK_TIMEOUT_MS = 600_000
const PROFILE = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : 'exp-standard'

/** 10 run 清单（5 任务 × 2 措辞变体；模型/任务面冻结于预注册 §3）。 */
const RUNS = [
  { id: 'T1-a', task: 'T1-checkout', contract: 'contract-T1.json', prompt: 'T1-a.txt' },
  { id: 'T1-b', task: 'T1-checkout', contract: 'contract-T1.json', prompt: 'T1-b.txt' },
  { id: 'T2-a', task: 'T2-pipeline', contract: 'contract-T2.json', prompt: 'T2-a.txt' },
  { id: 'T2-b', task: 'T2-pipeline', contract: 'contract-T2.json', prompt: 'T2-b.txt' },
  { id: 'T3-a', task: 'T3-cli-retry', contract: 'contract-T3.json', prompt: 'T3-a.txt' },
  { id: 'T3-b', task: 'T3-cli-retry', contract: 'contract-T3.json', prompt: 'T3-b.txt' },
  { id: 'T4-a', task: 'T4-report', contract: 'contract-T4.json', prompt: 'T4-a.txt' },
  { id: 'T4-b', task: 'T4-report', contract: 'contract-T4.json', prompt: 'T4-b.txt' },
  { id: 'H1-a', task: 'H1-csv', contract: 'contract-H1.json', prompt: 'H1-a.txt' },
  { id: 'H1-b', task: 'H1-csv', contract: 'contract-H1.json', prompt: 'H1-b.txt' },
]

function gitCommit(ws, message) {
  const init = spawnSync('git', ['init', '-q'], { cwd: ws, encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  const add = spawnSync('git', ['add', '-A'], { cwd: ws, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`)
  const commit = spawnSync('git', ['-c', 'user.email=m4@bench', '-c', 'user.name=m4', 'commit', '-qm', message], { cwd: ws, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`)
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim()
}

/** 单 run：pwsh 读 prompt 文件 → dsh --profile …（spike 同款调用形态），流式落盘 + 超时杀进程树。 */
function runModel(workspace, promptFile, logFile, timeoutMs) {
  return new Promise((resolvePromise) => {
    const promptWin = spawnSync('cygpath', ['-w', promptFile], { encoding: 'utf8' }).stdout.trim()
    const psCommand = `$job = Get-Content -Raw -LiteralPath '${promptWin}'; dsh --profile ${PROFILE} $job`
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
      cwd: workspace,
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
      windowsHide: true,
    })
    const logStream = createWriteStream(logFile, { flags: "a" })
    const started = Date.now()
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true })
      logStream.write(`\n[m4] TIMEOUT after ${timeoutMs}ms — process tree killed\n`)
    }, timeoutMs)
    child.stdout.on('data', (chunk) => logStream.write(chunk))
    child.stderr.on('data', (chunk) => logStream.write(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      logStream.end()
      resolvePromise({ ok: false, error: `spawn error: ${error.message}`, wallMs: Date.now() - started })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      logStream.end()
      resolvePromise({ ok: true, exitCode: code, wallMs: Date.now() - started, killed })
    })
  })
}

async function runOne(run, runDir) {
  const tag = `${run.id}`
  const ws = mkdtempSync(join(tmpdir(), `m4-run-${tag}-`))
  try {
    cpSync(join(tasksDir, run.task), ws, { recursive: true })
    const commit = gitCommit(ws, 'dispatch point')

    // 契约（填 baselineRef）
    const contractRaw = JSON.parse(readFileSync(join(contractsDir, run.contract), 'utf8'))
    if (contractRaw.baselineRef !== undefined) contractRaw.baselineRef = { type: 'git', commit }
    const contract = parseDispatchContract(contractRaw)
    const supplied = contractToSupplied(contract)

    // 真实模型执行
    const promptFile = join(here, 'prompts', run.prompt)
    const logFile = join(runDir, `${tag}.run.log`)
    const outcome = await runModel(ws, promptFile, logFile, TASK_TIMEOUT_MS)

    // 定位 session + 提取 tool-log
    let sessionId = null
    let toolLogPath
    const located = locateSessionLog('', ws)
    if (located === null) {
      throw new Error(`[m4] ${tag}: session log not found for workspace ${ws} (熔停)`)
    }
    sessionId = located.sessionId
    const events = decodeSessionLog(located.logPath)
    const toolEvents = sessionToToolEvents(events, ws)
    toolLogPath = join(runDir, `${tag}.tool-log.jsonl`)
    writeToolLog(toolEvents, toolLogPath)

    // 治疗臂全供给裁决
    const snap = mkdtempSync(join(tmpdir(), 'm4-snap-'))
    extractGitSnapshot({ repoDir: ws, commit, destDir: snap })
    const verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: snap, toolLogPath })
    rmSync(snap, { recursive: true, force: true })

    // 留档
    writeFileSync(join(runDir, `${tag}.verdict.json`), JSON.stringify({ run: run.id, task: run.task, outcome, sessionId, verdict }, null, 2) + '\n', 'utf8')
    writeFileSync(join(runDir, `${tag}.session-ref.json`), JSON.stringify({ sessionId, run: run.id }, null, 2) + '\n', 'utf8')
    writeFileSync(join(runDir, `${tag}.contract.json`), JSON.stringify(contract, null, 2) + '\n', 'utf8')
    const wsCopy = join(runDir, `ws-${tag}`)
    rmSync(wsCopy, { recursive: true, force: true })
    cpSync(ws, wsCopy, { recursive: true })

    return {
      run: run.id,
      task: run.task,
      prompt: run.prompt,
      stackVerdict: verdict.stackVerdict,
      reasons: verdict.reasons,
      medicines: verdict.medicines.map((m) => ({ id: m.id, applied: m.applied, ok: m.ok ?? null, classes: m.classes ?? null, violations: m.violations ?? null, failures: m.failures ?? null })),
      criterionOutcomes: verdict.criterionOutcomes,
      s1Conflicts: verdict.s1Conflicts.map((c) => `${c.kind}: ${c.detail}`),
      sessionId,
      wallMs: outcome.wallMs,
      killed: outcome.killed,
      exitCode: outcome.exitCode,
      timeout: outcome.killed,
    }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

function parseArgs(argv) {
  const args = { resume: null, only: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--resume') args.resume = argv[++i]
    else if (arg === '--only') args.only = argv[++i].split(',')
    else if (arg === '--profile') i += 1 // handled above
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`)
    else args.only.push(arg)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let runDir
  if (args.resume !== null) {
    if (!existsSync(args.resume)) throw new Error(`--resume dir not found: ${args.resume}`)
    runDir = args.resume
    console.log(`[m4] resume into ${runDir}`)
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    runDir = join(resultsRoot, `m4-${stamp}`)
    mkdirSync(runDir, { recursive: true })
  }
  const rowsPath = join(runDir, 'rows.jsonl')
  const rows = []
  const seen = new Set()
  if (existsSync(rowsPath)) {
    for (const line of readFileSync(rowsPath, 'utf8').trim().split('\n')) {
      if (line === '') continue
      const row = JSON.parse(line)
      rows.push(row)
      seen.add(row.run)
    }
    console.log(`[m4] resume: loaded ${rows.length} existing rows`)
  }

  const selected = args.only.length === 0 ? RUNS : RUNS.filter((run) => args.only.includes(run.id))
  if (selected.length === 0) throw new Error(`no runs matched: ${args.only.join(', ')}`)

  for (const run of selected) {
    if (seen.has(run.id)) {
      console.log(`[m4] skip (resume) ${run.id}`)
      continue
    }
    console.log(`[m4] starting ${run.id} (task=${run.task}, profile=${PROFILE})`)
    const row = await runOne(run, runDir)
    rows.push(row)
    writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    console.log(`[m4] ${run.id}: verdict=${row.stackVerdict} wall=${(row.wallMs / 1000).toFixed(1)}s${row.timeout ? ' TIMEOUT' : ''}`)
    for (const reason of row.reasons) console.log(`  - ${reason}`)
  }

  // 预注册与自检快照入结果目录
  cpSync(join(here, '..', 'M4-PRE-REGISTRATION.md'), join(runDir, 'M4-PRE-REGISTRATION.frozen.md'))
  const selfcheckPath = join(resultsRoot, 'm4-selfcheck', 'selfcheck.json')
  if (existsSync(selfcheckPath)) cpSync(selfcheckPath, join(runDir, 'selfcheck.json'))
  writeFileSync(join(runDir, 'DONE.marker'), JSON.stringify({ ts: Date.now(), rows: rows.length, profile: PROFILE }), 'utf8')
  console.log(`[m4] results in ${runDir} (${rows.length} rows)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
