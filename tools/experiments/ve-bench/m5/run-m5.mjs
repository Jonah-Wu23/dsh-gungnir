/**
 * m5/run-m5.mjs — H-VE M5 真实模型并发跑批器（M5 计划 §5，自 run-m4.mjs 演化）。
 *
 * 差异点（如实随档）：worker pool 2 封顶（--concurrency 只许调小）；RUNS manifest
 * 每 run 带 profile，分模型阶段跑批（同一时刻只跑单模型）；TASK_TIMEOUT_MS = 3000s；
 * session 防串结构断言（session-ref 落盘前校验 session 目录名含本 run 工作区尾段）；
 * 熔断语义：runOne 硬异常 → 清空待跑队列 + 对在跑 run 超时同级 taskkill + 非零退出，
 * 已落盘 rows 保留。
 *
 * 用法：node run-m5.mjs [--stage deepseek|glm|gpt] [--resume <dir>] [--only T1-a,H1-b] [--concurrency 1]
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDispatchContract, contractToSupplied } from '../../../../packages/core/dist/contract.js'
import { adjudicate } from '../../../ve-supply/adjudicate.mjs'
import { extractGitSnapshot } from '../../../ve-supply/snapshot.mjs'
import { decodeSessionLog, locateSessionLog, sessionToToolEvents, writeToolLog } from '../../../ve-supply/toollog.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))

/**
 * 泄题纪律：模型进程 env 净化。透传 process.env 会把 PWD/OLDPWD/INIT_CWD 等路径变量
 * （值含仓库根）带给模型——一条 `env`/`echo $OLDPWD` 即确定性泄露仓库路径（审查门
 * HIGH 项）。剔除路径类变量 + 值含仓库根的变量；保留运行必需项（PATH/SystemRoot/
 * TEMP/USERPROFILE 等）。
 */
function sanitizedEnv(extra = {}) {
  const repoRootLower = repoRoot.toLowerCase()
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === undefined || value === undefined) continue
    if (['PWD', 'OLDPWD', 'INIT_CWD', '_'].includes(key)) continue
    if (typeof value === 'string' && value.toLowerCase().includes(repoRootLower)) continue
    if (typeof value === 'string' && value.toLowerCase().includes('dsh-gungnir')) continue
    env[key] = value
  }
  return { ...env, ...extra }
}

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
const tasksDir = join(here, 'tasks')
const contractsDir = join(here, 'contracts')
const promptsDir = join(here, 'prompts')
const resultsRoot = join(here, 'results')
const TASK_TIMEOUT_MS = 3_000_000

/** 补测通道：--prompts-dir 覆盖 prompt 目录（如 prompts-answered/，M5 补测 gpt 用）。 */
let activePromptsDir = promptsDir

const PROFILES = {
  deepseek: { profile: 'exp-standard', label: 'deepseek-v4-flash-0731' },
  glm: { profile: 'exp-glm', label: 'glm-5.3-flash' },
  gpt: { profile: 'exp-codex', label: 'gpt-5.6-sol' },
}

/** 8 任务 run（4 任务 × 2 变体）；按阶段 × profile 组合成批。 */
const TASK_RUNS = [
  { id: 'T1-a', task: 'T1-ledgerd', contract: 'contract-T1.json', prompt: 'T1-a.txt' },
  { id: 'T1-b', task: 'T1-ledgerd', contract: 'contract-T1.json', prompt: 'T1-b.txt' },
  { id: 'T2-a', task: 'T2-relaypump', contract: 'contract-T2.json', prompt: 'T2-a.txt' },
  { id: 'T2-b', task: 'T2-relaypump', contract: 'contract-T2.json', prompt: 'T2-b.txt' },
  { id: 'T4-a', task: 'T4-billreport', contract: 'contract-T4.json', prompt: 'T4-a.txt' },
  { id: 'T4-b', task: 'T4-billreport', contract: 'contract-T4.json', prompt: 'T4-b.txt' },
  { id: 'H1-a', task: 'H1-cachekit', contract: 'contract-H1.json', prompt: 'H1-a.txt' },
  { id: 'H1-b', task: 'H1-cachekit', contract: 'contract-H1.json', prompt: 'H1-b.txt' },
]

function gitCommit(ws, message) {
  const init = spawnSync('git', ['init', '-q'], { cwd: ws, encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  const add = spawnSync('git', ['add', '-A'], { cwd: ws, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`)
  const commit = spawnSync('git', ['-c', 'user.email=m5@bench', '-c', 'user.name=m5', 'commit', '-qm', message], { cwd: ws, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`)
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim()
}

/** 单 run：pwsh 读 prompt（先复制到无仓库关联的临时文件）→ dsh --profile <stage-profile>，
 *  流式落盘 + 超时杀进程树。childRegistry 供并发熔停时 taskkill 在跑进程。 */
const childRegistry = new Set()

function runModel(workspace, promptFile, logFile, timeoutMs, profile, tag) {
  return new Promise((resolvePromise) => {
    // 泄题纪律：prompt 复制到系统临时目录（进程命令行不得出现仓库路径）
    const promptCopy = join(tmpdir(), `m5-prompt-${tag}.txt`)
    cpSync(promptFile, promptCopy)
    const promptWin = spawnSync('cygpath', ['-w', promptCopy], { encoding: 'utf8' }).stdout.trim()
    const psCommand = `$job = Get-Content -Raw -LiteralPath '${promptWin}'; dsh --profile ${profile} $job`
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
      cwd: workspace,
      env: sanitizedEnv({ DSH_TELEMETRY_DISABLED: '1' }),
      windowsHide: true,
    })
    childRegistry.add(child)
    const logStream = createWriteStream(logFile, { flags: 'a' })
    const started = Date.now()
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true })
      logStream.write(`\n[m5] TIMEOUT after ${timeoutMs}ms — process tree killed\n`)
    }, timeoutMs)
    child.stdout.on('data', (chunk) => logStream.write(chunk))
    child.stderr.on('data', (chunk) => logStream.write(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      childRegistry.delete(child)
      logStream.end()
      resolvePromise({ ok: false, error: `spawn error: ${error.message}`, wallMs: Date.now() - started })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      childRegistry.delete(child)
      logStream.end()
      resolvePromise({ ok: true, exitCode: code, wallMs: Date.now() - started, killed })
    })
  })
}

/** 并发熔停：对全部在跑 run 执行 taskkill（预注册 §6 语义）。 */
function killInFlight() {
  for (const child of childRegistry) {
    try {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true })
    } catch {
      // 已退出进程忽略
    }
  }
  childRegistry.clear()
}

/** session 防串结构断言：session 日志的编码父目录（cwd 编码）必须含本 run 工作区尾段
 *  （口径与 toollog.mjs findSessionLogByWorkspace 一致：路径最后两段编码），否则熔停。 */
function assertSessionMatchesWorkspace(logPath, workspace) {
  const parentDirName = resolve(logPath, '..', '..').split(/[/\\]/).filter(Boolean).pop() ?? ''
  const stamp = workspace.split(/[/\\]/).filter(Boolean)
  const tail = stamp.slice(-2).join('-')
  const encoded = tail.replace(/[^A-Za-z0-9-]/g, '-')
  if (!parentDirName.includes(encoded)) {
    throw new Error(`session cross-talk guard: session parent dir ${parentDirName} does not contain workspace tail ${encoded} (熔停)`)
  }
  return parentDirName
}

async function runOne(run, profileKey, runDir) {
  const profile = PROFILES[profileKey].profile
  const tag = `${profileKey}-${run.id}`
  const ws = mkdtempSync(join(tmpdir(), `m5-run-${tag}-`))
  try {
    cpSync(join(tasksDir, run.task), ws, { recursive: true })
    const commit = gitCommit(ws, 'dispatch point')
    const contractRaw = JSON.parse(readFileSync(join(contractsDir, run.contract), 'utf8'))
    if (contractRaw.baselineRef !== undefined) contractRaw.baselineRef = { type: 'git', commit }
    const contract = parseDispatchContract(contractRaw)
    const supplied = contractToSupplied(contract)

    const promptFile = join(activePromptsDir, run.prompt)
    const logFile = join(runDir, `${tag}.run.log`)
    const outcome = await runModel(ws, promptFile, logFile, TASK_TIMEOUT_MS, profile, tag)

    const located = locateSessionLog('', ws)
    if (located === null) throw new Error(`[m5] ${tag}: session log not found (熔停)`)
    assertSessionMatchesWorkspace(located.logPath, ws)
    const sessionId = located.sessionId
    const events = decodeSessionLog(located.logPath)
    const toolEvents = sessionToToolEvents(events, ws)
    const toolLogPath = join(runDir, `${tag}.tool-log.jsonl`)
    writeToolLog(toolEvents, toolLogPath)

    const snap = mkdtempSync(join(tmpdir(), 'm5-snap-'))
    extractGitSnapshot({ repoDir: ws, commit, destDir: snap })
    const verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: snap, toolLogPath })
    rmSync(snap, { recursive: true, force: true })

    writeFileSync(join(runDir, `${tag}.verdict.json`), JSON.stringify({ run: tag, task: run.task, profile: profileKey, outcome, sessionId, verdict }, null, 2) + '\n', 'utf8')
    writeFileSync(join(runDir, `${tag}.contract.json`), JSON.stringify(contract, null, 2) + '\n', 'utf8')
    const wsCopy = join(runDir, `ws-${tag}`)
    rmSync(wsCopy, { recursive: true, force: true })
    cpSync(ws, wsCopy, { recursive: true })

    return {
      run: tag,
      task: run.task,
      profile: profileKey,
      prompt: run.prompt,
      stackVerdict: verdict.stackVerdict,
      reasons: verdict.reasons,
      medicines: verdict.medicines.map((m) => ({ id: m.id, applied: m.applied, ok: m.ok ?? null, classes: m.classes ?? null, violations: m.violations ?? null, failures: m.failures ?? null })),
      criterionOutcomes: verdict.criterionOutcomes,
      s1Conflicts: verdict.s1Conflicts.map((c) => `${c.kind}: ${c.detail}`),
      sessionId,
      wallMs: outcome.wallMs,
      killed: outcome.killed,
      timeout: outcome.killed,
    }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

function parseArgs(argv) {
  const args = { stage: null, resume: null, only: [], concurrency: 2 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--stage') args.stage = argv[++i]
    else if (arg === '--resume') args.resume = argv[++i]
    else if (arg === '--prompts-dir') activePromptsDir = resolve(argv[++i])
    else if (arg === '--only') args.only = argv[++i].split(',')
    else if (arg === '--concurrency') args.concurrency = Math.min(2, Math.max(1, Number(argv[++i])))
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`)
    else args.only.push(arg)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const stages = args.stage === null ? ['deepseek', 'glm', 'gpt'] : [args.stage]
  for (const stage of stages) {
    if (PROFILES[stage] === undefined) throw new Error(`unknown stage: ${stage}`)
  }

  const runs = []
  for (const stage of stages) {
    for (const run of TASK_RUNS) {
      const id = `${stage}-${run.id}`
      if (args.only.length > 0 && !args.only.some((only) => id === only || run.id === only)) continue
      runs.push({ id, stage, ...run })
    }
  }
  if (runs.length === 0) throw new Error(`no runs matched: ${args.only.join(', ')}`)

  let runDir
  if (args.resume !== null) {
    if (!existsSync(args.resume)) throw new Error(`--resume dir not found: ${args.resume}`)
    runDir = args.resume
    console.log(`[m5] resume into ${runDir}`)
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    runDir = join(resultsRoot, `m5-${stamp}`)
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
      // HARD_FAIL 行不入 seen → --resume 重试（其余按 run id 去重）
      if (row.stackVerdict !== 'HARD_FAIL') seen.add(row.run)
    }
    console.log(`[m5] resume: loaded ${rows.length} existing rows`)
  }

  // worker pool：队列 shift 原子取 run；runOne 抛硬异常 → 清队列 + 杀在跑 + 熔停
  const queue = runs.filter((run) => !seen.has(run.id))
  console.log(`[m5] ${queue.length} runs to go (concurrency=${args.concurrency})`)
  let failed = false
  const worker = async () => {
    while (!failed) {
      const run = queue.shift()
      if (run === undefined) return
      console.log(`[m5] starting ${run.id} (profile=${PROFILES[run.stage].profile})`)
      let row
      try {
        row = await runOne(run, run.stage, runDir)
      } catch (error) {
        console.error(`[m5] HARD FAILURE ${run.id}: ${error.message} — 熔停整批`)
        failed = true
        killInFlight() // 对在跑 run 执行 taskkill（预注册 §6）
        queue.length = 0
        rows.push({ run: run.id, task: run.task, profile: run.stage, stackVerdict: 'HARD_FAIL', reasons: [`hard failure: ${error.message}`], timeout: false })
        writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
        process.exitCode = 1
        return
      }
      rows.push(row)
      writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
      console.log(`[m5] ${run.id}: verdict=${row.stackVerdict} wall=${(row.wallMs / 1000).toFixed(0)}s${row.timeout ? ' TIMEOUT' : ''}`)
      for (const reason of row.reasons.slice(0, 4)) console.log(`  - ${reason.slice(0, 140)}`)
    }
  }

  const workers = []
  for (let i = 0; i < args.concurrency; i++) workers.push(worker())
  await Promise.all(workers)

  const selfcheckPath = join(resultsRoot, 'm5-selfcheck', 'selfcheck.json')
  if (existsSync(selfcheckPath)) cpSync(selfcheckPath, join(runDir, 'selfcheck.json'))
  writeFileSync(join(runDir, 'DONE.marker'), JSON.stringify({ ts: Date.now(), rows: rows.length, stages }), 'utf8')
  console.log(`[m5] results in ${runDir} (${rows.length} rows)${failed ? ' — HARD FAIL' : ''}`)
  if (failed) process.exit(1)
}

// 仅直接执行时跑批（导入本模块不得触发——防测试/工具误触发正式批；basename 比较兼容
// `node run-m5.mjs` / `node ./run-m5.mjs` / 绝对路径三种调用形态）
const invokedAs = (process.argv[1] ?? '').replace(/\\/g, '/').split('/').pop()
if (invokedAs === 'run-m5.mjs') {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
