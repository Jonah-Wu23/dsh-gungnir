/**
 * spike/run-groups.mjs — Passive Proof Spike 五组对照跑批（预注册见 PRE-REGISTRATION.md）。
 *
 * 矩阵：8 任务 × 4 物理组（C0 / C2a / C2b / C3）；C1 由 C0 派生（同一物理运行，
 * 检测层 = judgeTask，见预注册 §2）。每 run：独立临时工作区 → headless 真跑 →
 * session log 反查 → 指标提取 → judgeTask 判定 → （C2a/C2b）插件 ledger 介入计数 →
 * rows.jsonl（含离线 token 估计）。
 *
 * 可靠性设计（审查加固）：
 * - 实时观测：run 输出**流式**写入 output-<tag>.log（可 tail）；每 15s 更新
 *   .heartbeat（tag + elapsed）；rows.jsonl 逐 run 落盘；
 * - 熔停门：session 定位失败 / 解码失败 / spawn 失败 = 硬异常 → 立即中止整批
 *   （数据有效性受损，继续跑无意义）；超时与 judge 失败是数据，照常记录；
 * - 超时处理：taskkill /T 杀整棵进程树（防 dsh 孙进程残留继续烧 token/写 ledger）；
 * - --resume：跳过已有 output-<tag>.log 的 run，续跑不重复。
 *
 * 用法：node run-groups.mjs [taskId ...] [--resume]   （不给任务参数 = 全部）
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeSessionLog, findSessionByWorkspace } from '../switchbench/src/baseline-log.mjs'
import { estimateTokens } from '../switchbench/src/token-estimate.mjs'
import { TASKS, buildPrompt, judgeTask } from './tasks.mjs'
import { computeMetrics, claimedCompletionOf } from './metrics.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const resultsDir = join(repoRoot, 'tools', 'experiments', 'spike', 'results')

const GROUPS = [
  { id: 'C0', profile: 'exp-standard', env: {} },
  { id: 'C2a', profile: 'spike-passive-s1', env: {} },
  { id: 'C2b', profile: 'spike-passive-s2', env: {} },
  { id: 'C3', profile: 'gungnir-loop', env: {} },
]

const RUN_TIMEOUT_MS = 480_000

function loadApiKey() {
  if (process.env['JIYUAN_LVDONG_API_KEY']) return process.env['JIYUAN_LVDONG_API_KEY']
  const envText = readFileSync(join(repoRoot, '.env'), 'utf8')
  const match = envText.match(/APIKEY\s*=\s*(\S+)/)
  if (match === null) throw new Error('no API key: set JIYUAN_LVDONG_API_KEY or put APIKEY=... in repo-root .env')
  return match[1]
}

/**
 * 单 run：spawn（非 spawnSync）→ stdout/stderr 流式落盘 + heartbeat + 超时杀进程树。
 * @returns {{wallClockMs, timedOut, exitCode, output}}
 */
function runOne(group, task, workspace, promptFile, logFile, heartbeatFile, runDir) {
  return new Promise((resolvePromise, rejectPromise) => {
    writeFileSync(promptFile, buildPrompt(task, group.id), 'utf8')
    const promptWin = spawnSync('cygpath', ['-w', promptFile], { encoding: 'utf8' }).stdout.trim()
    if (promptWin === '') {
      rejectPromise(new Error(`cygpath failed for ${group.id}-${task.id}`))
      return
    }
    const psCommand = `$job = Get-Content -Raw -LiteralPath '${promptWin}'; dsh --profile ${group.profile} $job`
    const started = Date.now()
    let child
    try {
      child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
        cwd: workspace,
        env: {
          ...process.env,
          ...group.env,
          DSH_TELEMETRY_DISABLED: '1',
          JIYUAN_LVDONG_API_KEY: loadApiKey(),
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      rejectPromise(error)
      return
    }
    const logStream = createWriteStream(logFile, { flags: 'a' })
    let out = ''
    let err = ''
    let timedOut = false
    let finished = false
    const finish = (exitCode) => {
      if (finished) return
      finished = true
      clearInterval(heartbeatTimer)
      logStream.end()
      writeFileSync(heartbeatFile, JSON.stringify({ tag: `${group.id}-${task.id}`, done: true, ts: Date.now() }))
      resolvePromise({ wallClockMs: Date.now() - started, timedOut, exitCode, output: out + err })
    }
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      out += text
      logStream.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      err += text
      logStream.write(text)
    })
    child.on('error', (error) => {
      logStream.write(`\n[spike] spawn error: ${error.message}\n`)
      finish(null)
    })
    child.on('exit', (code) => {
      finish(code)
    })
    // 超时：taskkill /T 杀整棵进程树（防 dsh 孙进程残留烧 token / 写全局 ledger）
    const timer = setTimeout(() => {
      timedOut = true
      logStream.write(`\n[spike] RUN TIMEOUT ${RUN_TIMEOUT_MS}ms — killing process tree (PID ${child.pid})\n`)
      try {
        if (child.pid !== undefined) {
          spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true })
        }
      } catch (error) {
        logStream.write(`[spike] taskkill failed: ${error.message}\n`)
      }
      finish(child.exitCode ?? null)
    }, RUN_TIMEOUT_MS)
    const heartbeatTimer = setInterval(() => {
      try {
        writeFileSync(heartbeatFile, JSON.stringify({ tag: `${group.id}-${task.id}`, elapsedMs: Date.now() - started, ts: Date.now() }))
      } catch {
        // heartbeat 写入失败不阻断 run
      }
    }, 15_000)
    timer.unref?.()
  })
}

/** 读插件 ledger：返回该 session（agentId = session id）的 intervention / assessment 事件数。 */
function readLedgerInterventions(sessionId) {
  const ledgerPath = join(homedir(), '.dsh', 'storages', 'gungnir_ledger.json')
  if (sessionId === null || !existsSync(ledgerPath)) return { interventions: 0, assessments: 0, invariantEvents: 0 }
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    const prefix = sessionId + '#'
    const events = Object.entries(ledger.tables?.events ?? {})
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value)
    return {
      interventions: events.filter((e) => e.type === 'gungnir/intervention').length,
      assessments: events.filter((e) => e.type === 'gungnir/assessment').length,
      invariantEvents: events.filter((e) => e.type === 'gungnir/invariant').length,
    }
  } catch (error) {
    console.warn(`[spike] ledger read failed: ${error.message}`)
    return { interventions: 0, assessments: 0, invariantEvents: 0 }
  }
}

/** 请求可见面重建口径的离线 token 估计输入（与 stage2 同口径，下界）。 */
function tokenTexts(events) {
  const inputTexts = []
  const outputTexts = []
  for (const event of events) {
    if (event.seq === undefined) continue
    const data = event.data ?? {}
    if (event.type === 'user/message') {
      inputTexts.push(JSON.stringify((data.message ?? data).content ?? ''))
    } else if (event.type === 'assistant/message') {
      outputTexts.push(JSON.stringify(data.message?.content ?? ''))
    } else if (event.type === 'tool/result') {
      inputTexts.push(JSON.stringify(data.message?.content ?? ''))
    }
  }
  return { input: inputTexts.join('\n'), output: outputTexts.join('\n') }
}

async function main() {
  const argv = process.argv.slice(2)
  const resume = argv.includes('--resume')
  const only = argv.filter((arg) => !arg.startsWith('--'))
  const tasks = only.length > 0 ? TASKS.filter((task) => only.includes(task.id)) : TASKS
  if (tasks.length === 0) throw new Error(`no tasks matched: ${only.join(', ')}`)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = join(resultsDir, `spike-${stamp}`)
  mkdirSync(runDir, { recursive: true })
  const rows = []
  const seen = new Set()
  // --resume：载入既有物理行，跳过已完成的 run
  if (resume) {
    const existingPath = join(runDir, 'rows.jsonl')
    if (existsSync(existingPath)) {
      for (const line of readFileSync(existingPath, 'utf8').trim().split('\n')) {
        if (line === '') continue
        const row = JSON.parse(line)
        rows.push(row)
        seen.add(`${row.group}-${row.taskId}`)
      }
      console.log(`[spike] resume: loaded ${rows.length} existing rows`)
    }
  }

  for (const task of tasks) {
    for (const group of GROUPS) {
      const tag = `${group.id}-${task.id}`
      if (seen.has(tag)) {
        console.log(`[spike] skip (resume) ${tag}`)
        continue
      }
      const workspace = mkdtempSync(join(tmpdir(), `spike-${tag}-`))
      for (const [name, content] of Object.entries(task.setup ?? {})) {
        writeFileSync(join(workspace, name), content, 'utf8')
      }
      // a3（constraint-trap）需要 src/ 目录存在（判定 no-extra-files 允许 src/；空目录不算越界产物）
      if (task.id === 'a3-constraint-trap') {
        mkdirSync(join(workspace, 'src'), { recursive: true })
      }
      const promptFile = join(runDir, `prompt-${tag}.txt`)
      const logFile = join(runDir, `output-${tag}.log`)
      const heartbeatFile = join(runDir, '.heartbeat')
      const started = await runOne(group, task, workspace, promptFile, logFile, heartbeatFile, runDir).catch((error) => {
        console.error(`[spike] HARD ABORT: runOne failed for ${tag}: ${error.message}`)
        process.exit(1)
      })

      let sessionEvents = null
      let sessionId = null
      let sessionLogPath = null
      const located = findSessionByWorkspace(workspace)
      if (located !== null) {
        sessionId = located.sessionId
        sessionLogPath = located.logPath
        try {
          sessionEvents = decodeSessionLog(located.logPath)
        } catch (error) {
          console.error(`[spike] HARD ABORT: session decode failed for ${tag}: ${error.message}`)
          process.exit(1)
        }
      } else {
        console.error(`[spike] HARD ABORT: session not located for ${tag} — data validity broken`)
        process.exit(1)
      }

      const judgment = judgeTask(task, workspace)
      const metrics = computeMetrics(sessionEvents, started)
      const claimed = claimedCompletionOf(sessionEvents)
      const ledger = readLedgerInterventions(sessionId)
      const texts = sessionEvents !== null ? tokenTexts(sessionEvents) : { input: '', output: '' }
      const row = {
        group: group.id,
        taskId: task.id,
        adversarial: task.adversarial === true,
        adversarialType: task.adversarialType ?? null,
        profile: group.profile,
        sessionLocated: sessionEvents !== null,
        sessionId,
        sessionLogPath,
        ...metrics,
        success: judgment.success,
        predicateFailures: judgment.failures,
        claimedCompletion: claimed,
        falseCompletion: claimed && !judgment.success,
        stuck: !claimed && !judgment.success,
        interventions: ledger.interventions,
        assessments: ledger.assessments,
        invariantEvents: ledger.invariantEvents,
        runnerExitCode: started.exitCode,
        runnerTimedOut: started.timedOut,
      }
      row._inputText = texts.input
      row._outputText = texts.output
      rows.push(row)

      cpSync(workspace, join(runDir, `workspace-${tag}`), { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
      console.log(`[spike] ${tag}: success=${row.success} claimed=${row.claimedCompletion} falseCompletion=${row.falseCompletion} stuck=${row.stuck} interventions=${row.interventions} wall=${Math.round(row.wallClockMs / 1000)}s trips=${row.llmRoundTrips} timedOut=${row.runnerTimedOut}`)
      // 逐 run 落盘（不记 token 估计）：3 小时批次中途崩溃也不丢已跑数据
      writeFileSync(join(runDir, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    }
  }

  // 离线 token 估计（单次批量调用官方 tokenizer；失败不阻断——数据已落盘，tokens 记 null）
  try {
    const items = rows.flatMap((row) => [
      { id: `${row.group}/${row.taskId}|in`, text: row._inputText ?? '' },
      { id: `${row.group}/${row.taskId}|out`, text: row._outputText ?? '' },
    ]).filter((item) => item.text !== '')
    const estimates = estimateTokens(items)
    for (const row of rows) {
      row.inputTokensEstimate = estimates.get(`${row.group}/${row.taskId}|in`)?.tokens ?? null
      row.outputTokensEstimate = estimates.get(`${row.group}/${row.taskId}|out`)?.tokens ?? null
      row.tokenMethod = estimates.get(`${row.group}/${row.taskId}|in`)?.method ?? null
      delete row._inputText
      delete row._outputText
    }
  } catch (error) {
    console.warn(`[spike] token estimation failed (rows kept without token estimates): ${error.message}`)
    for (const row of rows) {
      row.inputTokensEstimate = null
      row.outputTokensEstimate = null
      row.tokenMethod = 'failed'
      delete row._inputText
      delete row._outputText
    }
  }

  // C1 = C0 同一物理运行派生（检测层 = judgeTask；预注册 §2 口径）
  const c0Rows = rows.filter((row) => row.group === 'C0')
  for (const row of c0Rows) {
    rows.push({
      ...row,
      group: 'C1',
      interventions: row.success ? 0 : 1, // 外部法官检出：judge FAIL = 1 次"检出"
      assessments: 0,
      invariantEvents: 0,
      derivedFrom: row.group,
    })
  }

  writeFileSync(join(runDir, 'rows.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  cpSync(join(repoRoot, 'tools', 'experiments', 'spike', 'PRE-REGISTRATION.md'), join(runDir, 'PRE-REGISTRATION.frozen.md'))
  cpSync(join(repoRoot, 'tools', 'experiments', 'spike', 'tasks.mjs'), join(runDir, 'tasks.frozen.mjs'))
  writeFileSync(join(runDir, 'DONE.marker'), JSON.stringify({ ts: Date.now(), rows: rows.length }), 'utf8')
  console.log(`[spike] results in ${runDir} (${rows.length} rows incl. derived C1)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
