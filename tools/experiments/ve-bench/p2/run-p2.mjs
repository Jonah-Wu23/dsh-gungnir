/**
 * run-p2.mjs — P2 Escalation Proof Spike 真实模型并发跑批器（沿袭 m5 runner）。
 *
 * 差异（如实随档）：
 * - 新增 --arm E0|E2|E3 维度（E1 为派生臂，不占物理 run）；
 * - 契约经插件内部推导路径加载（passive p1/p2 不透明代号，无 --patch）；
 * - 完成声明行（create_goal + update_goal complete）进 B/C 层 prompt（wrapup seam 前提）；
 * - token 采集：E2/E3 解析插件 token-meter 末行 total；E0 解析 session log usage totalTokens。
 *
 * 用法：node run-p2.mjs [--arm E0,E2,E3] [--layer A,B,C] [--stage deepseek,glm,gpt]
 *                    [--resume <dir>] [--only E2-deepseek-T3-cli-retry-a] [--concurrency 1] [--c-backups]
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDispatchContract, contractToSupplied } from '../../../../packages/core/dist/contract.js'
import { adjudicate } from '../../../ve-supply/adjudicate.mjs'
import { extractGitSnapshot } from '../../../ve-supply/snapshot.mjs'
import { decodeSessionLog, locateSessionLog, sessionToToolEvents, writeToolLog } from '../../../ve-supply/toollog.mjs'
import { ARMS, STAGES, COMPLETION_LINE, ENV_NOTE, aLayerRuns, bLayerRuns, cLayerRuns, HERE } from './manifest.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const resultsRoot = join(HERE, 'results')
const TASK_TIMEOUT_MS = 3_000_000

/** 泄题纪律（M5 沿袭）：模型进程 env 净化（剔除路径类变量与值含仓库根的变量）。 */
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

function gitCommit(ws, message) {
  const init = spawnSync('git', ['init', '-q'], { cwd: ws, encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  const add = spawnSync('git', ['add', '-A'], { cwd: ws, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`)
  let commit = spawnSync('git', ['-c', 'user.email=p2@bench', '-c', 'user.name=p2', 'commit', '-qm', message], { cwd: ws, encoding: 'utf8' })
  if (commit.status !== 0) {
    // 空工作区（如 A 层 n1 任务开局零文件）：落 .gitkeep 保证有派发点快照
    writeFileSync(join(ws, '.gitkeep'), '', 'utf8')
    spawnSync('git', ['add', '-A'], { cwd: ws, encoding: 'utf8' })
    commit = spawnSync('git', ['-c', 'user.email=p2@bench', '-c', 'user.name=p2', 'commit', '-qm', message], { cwd: ws, encoding: 'utf8' })
    if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`)
  }
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim()
}

const childRegistry = new Set()

function runModel(workspace, promptFile, logFile, timeoutMs, profile, tag) {
  return new Promise((resolvePromise) => {
    // prompt 文件已在 %TEMP% 中性命名（泄题纪律），直接引用；无 --patch（契约经
    // 插件内部推导路径加载——命令行零泄露）。
    const promptWin = spawnSync('cygpath', ['-w', promptFile], { encoding: 'utf8' }).stdout.trim()
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
      logStream.write(`\n[p2] TIMEOUT after ${timeoutMs}ms — process tree killed\n`)
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

/** 从 run.log 解析插件 token-meter 末行 total（E2/E3；usage 锚点口径含 cacheRead）。 */
function tokensFromRunLog(runLogPath) {
  if (!existsSync(runLogPath)) return null
  const text = readFileSync(runLogPath, 'utf8')
  const lines = text.split('\n').filter((line) => line.includes('[gungnir] token-meter'))
  if (lines.length === 0) return null
  const last = lines[lines.length - 1]
  const total = /total=(\d+)/.exec(last)
  const input = /inputTokens:(\d+)/.exec(last)
  const output = /outputTokens:(\d+)/.exec(last)
  return {
    totalTokens: total !== null ? Number(total[1]) : null,
    inputTokens: input !== null ? Number(input[1]) : null,
    outputTokens: output !== null ? Number(output[1]) : null,
  }
}

/** 从 session log 的 assistant/message usage 取最后一次请求的 total（E0/gpt 兜底口径；
 * 与插件 token-meter 同语义：最后一次请求的累计总额含缓存输入；provider 缺 totalTokens
 * 字段时按 input+output+cacheRead 合成）。 */
function tokensFromSession(events) {
  let last = null
  for (const event of events) {
    const usage = event.data?.usage
    if (usage === undefined || typeof usage !== 'object') continue
    const total = typeof usage.totalTokens === 'number'
      ? usage.totalTokens
      : typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number'
        ? usage.inputTokens + usage.outputTokens + (typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0)
        : null
    if (total !== null) last = total
  }
  return { totalTokens: last, inputTokens: null, outputTokens: null }
}

/** 逐 run 的中性随机临时前缀（泄题纪律：文件/目录名不含臂名、任务代号、runId）。 */
function tmpPrefixOf() {
  return `p2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** A 层 spike 任务：材料化 setup 文件 + 构造 prompt（与 spike buildPrompt('C0') 同构）。 */
async function setupSpikeTask(ws, task) {
  const files = task.setup ?? {}
  for (const [rel, content] of Object.entries(files)) {
    const target = join(ws, rel)
    if (rel.includes('/')) {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dirname(target), { recursive: true })
    }
    writeFileSync(target, content, 'utf8')
  }
  const prompt = [
    `OBJECTIVE: ${task.objective}`,
    'Work in the current workspace. Produce exactly the required artifacts.',
    COMPLETION_LINE,
    ENV_NOTE,
  ].join('\n')
  return prompt
}

/** 冻结 prompt + 完成声明行（B 层；预注册偏差：仅新增声明指令，不含解法提示）。 */
function buildFrozenPrompt(promptFile) {
  const frozen = readFileSync(promptFile, 'utf8').trim()
  return `${frozen}\n\n${COMPLETION_LINE}`
}

async function runOne(run, runDir) {
  const arm = run.arm
  const stage = run.stage
  // 中性 profile 名（泄题纪律）：臂与模型均不在 profile 名暴露臂语义；gpt 通道 profile
  // 含 codex bundle + webserver（port 0）。模型后缀（ds/glm/gpt）是模型自知身份，非泄题。
  const profile = `${ARMS[arm].profile}-${STAGES[stage].suffix}`
  const tag = run.runId
  // 泄题纪律（审查门 HIGH 项）：工作区与全部临时文件去语义化——目录名/文件名不得含
  // 臂名、任务代号（如 C2-redherring）、runId。模型经 read/write 结果回显绝对路径，
  // 带语义的目录名会确定性暴露红鲱鱼设计与臂身份。
  const ws = mkdtempSync(join(tmpdir(), 'p2-ws-'))
  const tmpPrefix = tmpPrefixOf()
  const createdTmpFiles = []
  const trackTmp = (path) => {
    createdTmpFiles.push(path)
    return path
  }
  try {
    if (run.promptMode === 'spike') {
      const { TASKS } = await import('../../spike/tasks.mjs')
      const task = TASKS.find((t) => t.id === run.taskId)
      if (task === undefined) throw new Error(`spike task not found: ${run.taskId}`)
      await setupSpikeTask(ws, task)
      writeFileSync(trackTmp(join(tmpdir(), `${tmpPrefix}-task.txt`)), buildSpikePrompt(task), 'utf8')
    } else {
      if (run.taskDir === null || run.contract === null || run.promptFile === null) throw new Error(`run ${run.runId}: task/contract/prompt required`)
      cpSync(run.taskDir, ws, { recursive: true })
    }
    const commit = gitCommit(ws, 'dispatch point')

    // 契约：解析 + baselineRef 回填（仅契约已声明 baselineRef 的任务）。
    // 泄题纪律（严格）：契约写到与插件推导一致的派生路径（%TEMP%/p2-supply-<ws目录名>.json），
    // 插件在 dsh 启动瞬间加载即删——命令行无契约路径、无 --patch；模型可见面任何时刻
    // 不存在契约文件。runner 侧留档契约副本（harness 产物，E1 派生用）。
    let supplied = null
    if (run.contract !== null) {
      const contractRaw = JSON.parse(readFileSync(run.contract, 'utf8'))
      if (contractRaw.baselineRef !== undefined) contractRaw.baselineRef = { type: 'git', commit }
      const contract = parseDispatchContract(contractRaw)
      supplied = contractToSupplied(contract)
      const wsName = ws.split(/[\\/]/).filter(Boolean).pop() ?? 'ws'
      writeFileSync(join(tmpdir(), `p2-supply-${wsName}.json`), JSON.stringify(contract, null, 2), 'utf8')
      // 留档契约（冻结副本，harness 侧）
      writeFileSync(join(runDir, `${tag}.contract.json`), JSON.stringify(contract, null, 2) + '\n', 'utf8')
    }

    const promptFile = run.promptMode === 'spike'
      ? join(tmpdir(), `${tmpPrefix}-task.txt`)
      : trackTmp(join(tmpdir(), `${tmpPrefix}-prompt.txt`))
    if (run.promptMode !== 'spike') {
      writeFileSync(promptFile, buildFrozenPrompt(run.promptFile), 'utf8')
    }
    const logFile = join(runDir, `${tag}.run.log`)
    const outcome = await runModel(ws, promptFile, logFile, TASK_TIMEOUT_MS, profile, tag)

    const located = locateSessionLog('', ws)
    if (located === null) throw new Error(`[p2] ${tag}: session log not found (熔停)`)
    assertSessionMatchesWorkspace(located.logPath, ws)
    const sessionId = located.sessionId
    const events = decodeSessionLog(located.logPath)
    const toolEvents = sessionToToolEvents(events, ws)
    const toolLogPath = join(runDir, `${tag}.tool-log.jsonl`)
    writeToolLog(toolEvents, toolLogPath)

    const tokens = tokensFromRunLog(logFile) ?? tokensFromSession(events)
    const roundTrips = events.filter((e) => e.type === 'assistant/message').length
    const snap = mkdtempSync(join(tmpdir(), 'p2-snap-'))
    let verdict = null
    try {
      if (supplied !== null) {
        extractGitSnapshot({ repoDir: ws, commit, destDir: snap })
        verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: snap, toolLogPath })
      }
    } finally {
      rmSync(snap, { recursive: true, force: true })
    }

    writeFileSync(join(runDir, `${tag}.verdict.json`), JSON.stringify({ run: tag, layer: run.layer, arm, task: run.taskId, stage, outcome, sessionId, tokens, roundTrips, verdict }, null, 2) + '\n', 'utf8')
    writeFileSync(join(runDir, `${tag}.session-ref.json`), JSON.stringify({ sessionId, run: tag, arm, stage }), 'utf8')
    const wsCopy = join(runDir, `ws-${tag}`)
    rmSync(wsCopy, { recursive: true, force: true })
    cpSync(ws, wsCopy, { recursive: true })

    return {
      run: tag,
      layer: run.layer,
      arm,
      task: run.taskId,
      stage,
      prompt: run.promptMode,
      stackVerdict: verdict?.stackVerdict ?? null,
      reasons: verdict?.reasons ?? [],
      medicines: (verdict?.medicines ?? []).map((m) => ({ id: m.id, applied: m.applied, ok: m.ok ?? null, classes: m.classes ?? null, violations: m.violations ?? null, failures: m.failures ?? null })),
      criterionOutcomes: verdict?.criterionOutcomes ?? [],
      s1Conflicts: (verdict?.s1Conflicts ?? []).map((c) => `${c.kind}: ${c.detail}`),
      sessionId,
      tokens,
      roundTrips,
      wallMs: outcome.wallMs,
      killed: outcome.killed,
      timeout: outcome.killed,
    }
  } finally {
    rmSync(ws, { recursive: true, force: true })
    // 泄题纪律（审查门 MEDIUM 项）：契约/patch/prompt 临时文件跑完即删（%TEMP% 不留
    // 可被 ls .. 发现的残留）。契约文件插件在 boot 时加载即删，此处为插件未 boot
    // （dsh 启动失败）时的兜底。
    const wsName = ws.split(/[\\/]/).filter(Boolean).pop() ?? 'ws'
    try {
      rmSync(join(tmpdir(), `p2-supply-${wsName}.json`), { force: true })
    } catch {
      // 清理失败不阻断
    }
    for (const tmpFile of createdTmpFiles) {
      try {
        rmSync(tmpFile, { force: true })
      } catch {
        // 清理失败不阻断（文件在 %TEMP%，窗口期极短）
      }
    }
  }
}

function buildSpikePrompt(task) {
  return [
    `OBJECTIVE: ${task.objective}`,
    'Work in the current workspace. Produce exactly the required artifacts.',
    COMPLETION_LINE,
    ENV_NOTE,
  ].join('\n')
}

function parseArgs(argv) {
  const args = { arm: null, layer: null, stage: null, resume: null, only: [], force: [], concurrency: 2, cBackups: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--arm') args.arm = argv[++i].split(',')
    else if (arg === '--layer') args.layer = argv[++i].split(',')
    else if (arg === '--stage') args.stage = argv[++i].split(',')
    else if (arg === '--resume') args.resume = argv[++i]
    else if (arg === '--concurrency') args.concurrency = Math.min(2, Math.max(1, Number(argv[++i])))
    else if (arg === '--c-backups') args.cBackups = true
    else if (arg === '--only') args.only = argv[++i].split(',')
    else if (arg === '--force') args.force = argv[++i].split(',')
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`)
    else args.only.push(arg)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  // 跑批前预检（泄题纪律）：%TEMP% 不得存在任何实验词/任务代号/监督面残留（审查门
  // 反复抓出的环境残留类别）。命中即熔停——环境不干净不跑批（铁律 10 装置合意性）。
  const experimentVocab = /gungnir|spike|switchbench|ve-bench|ve-supply|m5-|m4-|stage2|loop-|probe|^p2-|^ve-|fix-c|s2check|smoke-run|inspect|report-verify|merge_vs|test-guard|gpt-t1|ledger|contract/i
  const tempResidues = readdirSync(tmpdir()).filter((name) => experimentVocab.test(name))
  if (tempResidues.length > 0) {
    throw new Error(`[p2] preflight FAIL: %TEMP% contains experiment-vocab residues (泄题纪律): ${tempResidues.slice(0, 10).join(', ')}${tempResidues.length > 10 ? ` ... (+${tempResidues.length - 10})` : ''} — 清理后再跑批`)
  }
  let runs = [...aLayerRuns(), ...bLayerRuns(), ...cLayerRuns({ backup: args.cBackups })]
  if (args.layer !== null) runs = runs.filter((r) => args.layer.includes(r.layer))
  if (args.arm !== null) runs = runs.filter((r) => args.arm.includes(r.arm))
  if (args.stage !== null) runs = runs.filter((r) => args.stage.includes(r.stage))
  if (args.only.length > 0) runs = runs.filter((r) => args.only.some((only) => r.runId === only || r.taskId === only || only === r.runId.slice(r.runId.lastIndexOf('-') + 1) || r.runId.endsWith('-' + only)))
  if (runs.length === 0) throw new Error(`no runs matched`)

  let runDir
  if (args.resume !== null) {
    if (!existsSync(args.resume)) throw new Error(`--resume dir not found: ${args.resume}`)
    runDir = args.resume
    console.log(`[p2] resume into ${runDir}`)
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    runDir = join(resultsRoot, `p2-${stamp}`)
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
      if (row.stackVerdict !== 'HARD_FAIL') seen.add(row.run)
    }
    console.log(`[p2] resume: loaded ${rows.length} existing rows`)
  }

  const queue = runs.filter((run) => args.force.includes(run.runId) || !seen.has(run.runId))
  console.log(`[p2] ${queue.length} runs to go (concurrency=${args.concurrency})`)
  let failed = false
  const worker = async () => {
    while (!failed) {
      const run = queue.shift()
      if (run === undefined) return
      console.log(`[p2] starting ${run.runId} (arm=${run.arm} profile=${ARMS[run.arm].profile}-${STAGES[run.stage].suffix})`)
      let row
      try {
        row = await runOne(run, runDir)
      } catch (error) {
        console.error(`[p2] HARD FAILURE ${run.runId}: ${error.message} — 熔停整批`)
        failed = true
        killInFlight()
        queue.length = 0
        rows.push({ run: run.runId, layer: run.layer, arm: run.arm, task: run.taskId, stage: run.stage, stackVerdict: 'HARD_FAIL', reasons: [`hard failure: ${error.message}`], timeout: false })
        writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
        process.exitCode = 1
        return
      }
      rows.push(row)
      writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
      console.log(`[p2] ${run.runId}: verdict=${row.stackVerdict} wall=${(row.wallMs / 1000).toFixed(0)}s tokens=${row.tokens?.totalTokens ?? 'n/a'}${row.timeout ? ' TIMEOUT' : ''}`)
      for (const reason of row.reasons.slice(0, 4)) console.log(`  - ${reason.slice(0, 140)}`)
    }
  }

  const workers = []
  for (let i = 0; i < args.concurrency; i++) workers.push(worker())
  await Promise.all(workers)

  writeFileSync(join(runDir, 'DONE.marker'), JSON.stringify({ ts: Date.now(), rows: rows.length, layers: args.layer, arms: args.arm }), 'utf8')
  console.log(`[p2] results in ${runDir} (${rows.length} rows)${failed ? ' — HARD FAIL' : ''}`)
  if (failed) process.exit(1)
}

const invokedAs = (process.argv[1] ?? '').replace(/\\/g, '/').split('/').pop()
if (invokedAs === 'run-p2.mjs') {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
