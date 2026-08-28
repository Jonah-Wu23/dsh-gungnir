/**
 * stage2/run-groups.mjs — 四组对照实验跑批（预注册见 PRE-REGISTRATION.md）。
 *
 * 矩阵：6 任务 × 4 组（standard / ptc / workflow / gungnir），顺序执行。
 * 每 run：独立临时工作区 → 预置 setup 文件 → headless 真跑 → session log 反查解码 →
 * 指标提取 → 确定性谓词判定 → 工作区与 prompt 归档 → rows.jsonl（含离线 token 估计）。
 *
 * 用法：node run-groups.mjs [taskId ...]   （不给参数 = 全部任务全组）
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeSessionLog, findSessionByWorkspace } from '../switchbench/src/baseline-log.mjs'
import { estimateTokens } from '../switchbench/src/token-estimate.mjs'
import { TASKS, buildPrompt, judgeTask } from './tasks.mjs'
import { computeMetrics } from './metrics.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const resultsDir = join(repoRoot, 'tools', 'experiments', 'stage2', 'results')

const GROUPS = [
  { id: 'standard', profile: 'exp-standard', env: {} },
  { id: 'ptc', profile: 'exp-standard', env: { DSH_TOOLS_MODE: 'ptc' } },
  { id: 'workflow', profile: 'exp-standard', env: {} },
  { id: 'gungnir', profile: 'gungnir-loop', env: {} },
]

const RUN_TIMEOUT_MS = 600_000

function loadApiKey() {
  if (process.env['JIYUAN_LVDONG_API_KEY']) return process.env['JIYUAN_LVDONG_API_KEY']
  const envText = readFileSync(join(repoRoot, '.env'), 'utf8')
  const match = envText.match(/APIKEY\s*=\s*(\S+)/)
  if (match === null) throw new Error('no API key: set JIYUAN_LVDONG_API_KEY or put APIKEY=... in repo-root .env')
  return match[1]
}

function runOne(group, task, workspace, promptFile) {
  writeFileSync(promptFile, buildPrompt(task, group.id), 'utf8')
  const promptWin = spawnSync('cygpath', ['-w', promptFile], { encoding: 'utf8' }).stdout.trim()
  const psCommand = `$job = Get-Content -Raw -LiteralPath '${promptWin}'; dsh --profile ${group.profile} $job`
  const started = Date.now()
  const attempt = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
    cwd: workspace,
    env: {
      ...process.env,
      ...group.env,
      DSH_TELEMETRY_DISABLED: '1',
      JIYUAN_LVDONG_API_KEY: loadApiKey(),
    },
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    wallClockMs: Date.now() - started,
    timedOut: attempt.error?.code === 'ETIMEDOUT' ?? false,
    exitCode: attempt.status,
    output: `${attempt.stdout ?? ''}${attempt.stderr ?? ''}`,
  }
}

/** 请求可见面重建口径的离线 token 估计输入（system prompt 与工具 schema 不在内 → 下界）。 */
function tokenTexts(events) {
  const inputTexts = []
  const outputTexts = []
  for (const event of events) {
    if (event.seq === undefined) continue
    const data = event.data ?? {}
    if (event.type === 'user/message') {
      const message = data.message ?? data
      inputTexts.push(JSON.stringify(message.content ?? ''))
    } else if (event.type === 'assistant/message') {
      outputTexts.push(JSON.stringify(data.message?.content ?? ''))
    } else if (event.type === 'tool/result') {
      inputTexts.push(JSON.stringify(data.message?.content ?? ''))
    }
  }
  return { input: inputTexts.join('\n'), output: outputTexts.join('\n') }
}

async function main() {
  const only = process.argv.slice(2)
  const tasks = only.length > 0 ? TASKS.filter(task => only.includes(task.id)) : TASKS
  if (tasks.length === 0) throw new Error(`no tasks matched: ${only.join(', ')}`)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = join(resultsDir, `stage2-${stamp}`)
  mkdirSync(runDir, { recursive: true })
  const rows = []

  for (const task of tasks) {
    for (const group of GROUPS) {
      const tag = `${group.id}-${task.id}`
      const workspace = mkdtempSync(join(tmpdir(), `stage2-${tag}-`))
      for (const [name, content] of Object.entries(task.setup)) {
        writeFileSync(join(workspace, name), content, 'utf8')
      }
      const promptFile = join(runDir, `prompt-${tag}.txt`)
      const started = runOne(group, task, workspace, promptFile)

      let sessionEvents = null
      let sessionLogPath = null
      const located = findSessionByWorkspace(workspace)
      if (located !== null) {
        sessionLogPath = located.logPath
        try {
          sessionEvents = decodeSessionLog(located.logPath)
        } catch (error) {
          console.warn(`[stage2] session decode failed for ${tag}: ${error.message}`)
        }
      } else {
        console.warn(`[stage2] session not located for ${tag}`)
      }

      const judgment = judgeTask(task, workspace)
      const metrics = computeMetrics(sessionEvents, started)
      const texts = sessionEvents !== null ? tokenTexts(sessionEvents) : { input: '', output: '' }
      const row = {
        group: group.id,
        taskId: task.id,
        profile: group.profile,
        sessionLocated: sessionEvents !== null,
        sessionLogPath,
        ...metrics,
        success: judgment.success,
        predicateFailures: judgment.failures,
        runnerExitCode: started.exitCode,
        runnerTimedOut: started.timedOut,
      }
      row._inputText = texts.input
      row._outputText = texts.output
      rows.push(row)

      cpSync(workspace, join(runDir, `workspace-${tag}`), { recursive: true, force: true })
      writeFileSync(join(runDir, `output-${tag}.log`), started.output, 'utf8')
      rmSync(workspace, { recursive: true, force: true })
      console.log(`[stage2] ${tag}: success=${row.success} wall=${Math.round(row.wallClockMs / 1000)}s trips=${row.llmRoundTrips} tools=${row.toolCalls} errors=${row.validationFailures}`)
      var rmSyncRef = null // eslint-note: rmSync imported below via destructure shadow avoidance
    }
  }

  // 离线 token 估计（单次批量调用官方 tokenizer）
  const items = rows.flatMap(row => [
    { id: `${row.group}/${row.taskId}|in`, text: row._inputText ?? '' },
    { id: `${row.group}/${row.taskId}|out`, text: row._outputText ?? '' },
  ]).filter(item => item.text !== '')
  const estimates = estimateTokens(items)
  for (const row of rows) {
    row.inputTokensEstimate = estimates.get(`${row.group}/${row.taskId}|in`)?.tokens ?? null
    row.outputTokensEstimate = estimates.get(`${row.group}/${row.taskId}|out`)?.tokens ?? null
    row.tokenMethod = estimates.get(`${row.group}/${row.taskId}|in`)?.method ?? null
    delete row._inputText
    delete row._outputText
  }

  writeFileSync(join(runDir, 'rows.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  cpSync(join(repoRoot, 'tools', 'experiments', 'stage2', 'PRE-REGISTRATION.md'), join(runDir, 'PRE-REGISTRATION.frozen.md'))
  cpSync(join(repoRoot, 'tools', 'experiments', 'stage2', 'tasks.mjs'), join(runDir, 'tasks.frozen.mjs'))
  console.log(`[stage2] results in ${runDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
