/**
 * SwitchBench Baseline 跑批（Day 1 建成；Day 5 起 timeout 随事故 #5 统一为 600s）。
 *
 * 架构：Baseline = 普通 DSH（switchbench-base profile，无 Gungnir 插件），
 * 经 tools/dsh-shim（v0.1.2-alpha.1 源码构建）+ `dsh --profile switchbench-base`。
 * 冻结模型：deepseek-v4-flash-0731 @ jiyuan-lvdong (https://tokenrhythm.studio/v1)，
 * 凭据从仓库根 .env 的 APIKEY 读取（或环境变量 JIYUAN_LVDONG_API_KEY），不打印。
 *
 * 运行口径（EXPERIMENT.md §10）：
 * - DSH_PERMISSION_MODE=workspace-write（平台默认安全档：写限于工作区 + 会话私有
 *   temp，升级类操作才会触发审批；本实验动作面全部在沙箱内，无提权需求。
 *   注意：该沙箱只限写不限读——防读泄漏靠临时目录物料化 + prompt 约束 6，
 *   与权限档位无关）
 * - DSH_TELEMETRY_DISABLED=1
 * - cwd = 每 run 在**系统临时目录**物料化的任务 workspace 副本（run 结束后证据回拷
 *   results/workspaces/）。工作区必须远离仓库树：首跑（run-2026-08-28T15-48-41-646Z，
 *   已判废）中模型在完全访问下读穿了仓库内的 harness（tasks/ 模板、判据），污染了
 *   任务——临时目录物料化消除这类顺路泄漏。
 * - 单任务超时 600s（冻结修正事故 #5；deadline.mjs 为单一来源）
 * - token 计数暂不可得（OPEN-5 未决）：Day 1 只记 wall-clock，session id 留档
 *   供后续 Gate 2 / Gate 3 从 session log 复盘（v0.1.2 headless 不打印 session id，
 *   从 ~/.dsh/sessions/ 按 cwd 编码目录反查）
 *
 * 用法：node src/run-baseline.mjs [taskId ...]   （不给参数 = 只跑 Killer Task t01）
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { KILLER_TASK, TASKS, TASK_PROMPT } from './tasks.mjs'
import { verifyWorkspace } from './verify.mjs'
import { TASK_TIMEOUT_MS } from './deadline.mjs'

const switchbenchRoot = fileURLToPath(new URL('..', import.meta.url))
const resultsDir = join(switchbenchRoot, 'results')

function loadApiKey() {
  if (process.env['JIYUAN_LVDONG_API_KEY']) return process.env['JIYUAN_LVDONG_API_KEY']
  const envText = readFileSync(resolve(switchbenchRoot, '../../../.env'), 'utf8')
  const match = envText.match(/APIKEY\s*=\s*(\S+)/)
  if (match === null) throw new Error('no API key: set JIYUAN_LVDONG_API_KEY or put APIKEY=... in repo-root .env')
  return match[1]
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function runDsh(workspace, promptFile, apiKey) {
  const psCommand = `$job = Get-Content -Raw -LiteralPath '${promptFile}'; dsh --profile switchbench-base $job`
  const candidates = [
    ['pwsh', ['-NoProfile', '-NonInteractive', '-Command', psCommand]],
    [join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand]],
  ]
  const started = Date.now()
  let last = { stdout: '', stderr: '', status: null }
  let lastError = ''
  for (const [bin, args] of candidates) {
    const attempt = spawnSync(bin, args, {
      cwd: workspace,
      env: {
        ...process.env,
        JIYUAN_LVDONG_API_KEY: apiKey,
        DSH_PERMISSION_MODE: 'workspace-write',
        DSH_TELEMETRY_DISABLED: '1',
      },
      encoding: 'utf8',
      timeout: TASK_TIMEOUT_MS, // 冻结修正：300s → 600s（BENCHMARK.md §7 事故 #5，三架构统一预算）
      maxBuffer: 32 * 1024 * 1024,
    })
    last = attempt
    const out = `${attempt.stdout ?? ''}${attempt.stderr ?? ''}`
    if (!attempt.error && out.includes('dsh:')) break
    lastError = attempt.error ? String(attempt.error.message) : out.slice(-300)
  }
  if (lastError !== '' && `${last.stdout ?? ''}${last.stderr ?? ''}` === '') {
    console.warn(`  (runner note: ${lastError})`)
  }
  return { ...last, elapsedMs: Date.now() - started }
}

/**
 * v0.1.2 headless 不把 session id 打进 stdout/stderr；session 落盘目录按 cwd
 * 路径编码（非字母数字 → '-'，尾部带 '--' 尾巴），内含 session-<uuid> 子目录。
 * run 戳在工作区路径里唯一，可反查本 run 的 session 目录，取其中最新 mtime 的
 * session。输出里若直接出现 session id 则优先采用。
 */
function findSessionId(output, workspace) {
  const fromOutput = output.match(/session-[0-9a-f-]{8,}/)
  if (fromOutput !== null) return fromOutput[0]
  const sessionsRoot = join(homedir(), '.dsh', 'sessions')
  const runStamp = basename(dirname(workspace))
  try {
    const encodedDir = readdirSync(sessionsRoot).find((name) => name.includes(runStamp))
    if (encodedDir === undefined) return null
    const encodedPath = join(sessionsRoot, encodedDir)
    const candidates = readdirSync(encodedPath).filter((name) => name.startsWith('session-'))
    if (candidates.length === 0) return null
    candidates.sort((a, b) => statSync(join(encodedPath, b)).mtimeMs - statSync(join(encodedPath, a)).mtimeMs)
    return candidates[0]
  } catch {
    return null
  }
}

/** src 足迹：工作区 src 相对 pristine 模板的 changed/added/deleted（纪律证据）。 */
function srcFootprint(workspace, taskDir) {
  function srcFiles(root) {
    const map = new Map()
    const stack = [join(root, 'src')]
    while (stack.length > 0) {
      const dir = stack.pop()
      let entries
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of entries) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) stack.push(full)
        else map.set(join(full, '').replace(root, '').replace(/\\/g, '/'), sha256(full))
      }
    }
    return map
  }
  const pristine = srcFiles(join(taskDir, 'repo'))
  const current = srcFiles(workspace)
  const changed = []
  const added = []
  const deleted = []
  for (const [rel, hash] of current.entries()) {
    const before = pristine.get(rel)
    if (before === undefined) added.push(rel)
    else if (before !== hash) changed.push(rel)
  }
  for (const rel of pristine.keys()) if (!current.has(rel)) deleted.push(rel)
  return { changed: changed.sort(), added: added.sort(), deleted: deleted.sort() }
}

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const selected = only.length === 0 ? [KILLER_TASK] : TASKS.filter((task) => only.includes(task.id))
if (selected.length === 0) {
  console.error(`unknown task id(s): ${only.join(', ')}; known: ${TASKS.map((task) => task.id).join(', ')}`)
  process.exit(2)
}

const apiKey = loadApiKey()
const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
const tempRoot = join(tmpdir(), 'switchbench-workspaces', `run-${runStamp}`)
const evidenceDir = join(resultsDir, 'workspaces', `run-${runStamp}`)
mkdirSync(tempRoot, { recursive: true })
mkdirSync(evidenceDir, { recursive: true })
console.log(`SwitchBench Baseline run ${runStamp}: ${selected.map((task) => task.id).join(', ')}`)
console.log(`model: deepseek-v4-flash-0731 @ jiyuan-lvdong (frozen); profile: switchbench-base (plain DSH)`)
console.log(`workspaces (isolated from repo): ${tempRoot}`)

const rows = []
for (const task of selected) {
  const taskDir = join(switchbenchRoot, 'tasks', task.dir)
  const workspace = join(tempRoot, task.id)
  cpSync(join(taskDir, 'repo'), workspace, { recursive: true })
  const promptFile = join(evidenceDir, `${task.id}.prompt.txt`)
  writeFileSync(promptFile, TASK_PROMPT, 'utf8')

  const startedAt = new Date().toISOString()
  console.log(`\n--- ${task.id} ${task.killer ? '(KILLER)' : ''} ${task.title}`)
  const dsh = runDsh(workspace, promptFile, apiKey)
  const output = `${dsh.stdout ?? ''}\n${dsh.stderr ?? ''}`
  writeFileSync(join(evidenceDir, `${task.id}.output.txt`), output, 'utf8')
  const sessionId = findSessionId(output, workspace)

  let verifyResult
  try {
    verifyResult = verifyWorkspace(workspace, taskDir)
  } catch (error) {
    verifyResult = { verdict: 'ERROR', gates: {}, error: error instanceof Error ? error.message : String(error) }
  }
  const footprint = srcFootprint(workspace, taskDir)

  // 证据回拷：run 后的 workspace 是第一现场，收进 results 留档。
  cpSync(workspace, join(evidenceDir, task.id), { recursive: true })

  const row = {
    taskId: task.id,
    killer: task.killer,
    title: task.title,
    startedAt,
    elapsedMs: dsh.elapsedMs,
    dshExitCode: dsh.status,
    sessionId,
    workspace: workspace,
    promptSha256: createHash('sha256').update(TASK_PROMPT).digest('hex'),
    verify: verifyResult,
    srcFootprint: footprint,
    vgcrPass: verifyResult.verdict === 'PASS',
    outputTail: output.slice(-1200),
  }
  rows.push(row)

  const trunk = verifyResult.gates?.trunkTestsPass
  console.log(
    `result: ${verifyResult.verdict} | probe=${verifyResult.gates?.bugNotReproducible?.ok ? 'clean' : 'repro'} | trunk=${trunk ? `${trunk.counts?.pass}/${trunk.counts?.tests}` : 'n/a'} | integrity=${verifyResult.gates?.integrity?.ok} | exports=${verifyResult.gates?.exports?.ok} | wall=${(dsh.elapsedMs / 1000).toFixed(1)}s | session=${sessionId ?? 'none'}`,
  )
  console.log(`src footprint: changed=${JSON.stringify(footprint.changed)} added=${JSON.stringify(footprint.added)} deleted=${JSON.stringify(footprint.deleted)}`)
  if (verifyResult.error !== undefined) console.log(`verify error: ${verifyResult.error}`)
  for (const gate of Object.values(verifyResult.gates ?? {})) {
    for (const violation of gate.violations ?? []) console.log(`  violation: ${violation}`)
  }
}

// ---- run 报告（EXPERIMENT.md §11：每 run 落 results/run-<ts>.{json,md}）-----------
const jsonPath = join(resultsDir, `run-${runStamp}.json`)
writeFileSync(
  jsonPath,
  `${JSON.stringify(
    {
      architecture: 'baseline (plain DSH, no Gungnir plugin)',
      model: 'deepseek-v4-flash-0731 @ jiyuan-lvdong (https://tokenrhythm.studio/v1, openai-completions) — frozen',
      profile: 'switchbench-base (hand-created: dsh-base + dsh-headless, agent-default-model -> frozen model)',
      runtimeNotes: {
        permissionMode: 'workspace-write (platform default; write-confined to workspace + private temp; escalations would fail closed in headless — none expected for this task surface)',
        telemetry: 'DSH_TELEMETRY_DISABLED=1',
        taskTimeoutMs: TASK_TIMEOUT_MS,
        workspaceIsolation: 'run workspaces materialized under os.tmpdir(), outside the repository (first killer run was voided for harness leakage; see results/void-*)',
        tokenMetering: 'unavailable on plugin side (OPEN-5 open); Day 1 records wall-clock only; session logs kept under ~/.dsh/sessions for later Gate 2/3 scoring',
      },
      promptSha256: createHash('sha256').update(TASK_PROMPT).digest('hex'),
      runDir: evidenceDir,
      rows,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  'utf8',
)

const md = [
  `# SwitchBench Baseline run \`${runStamp}\``,
  '',
  '- 架构：**Baseline**（普通 DSH，`switchbench-base` profile，无 Gungnir 插件，普通 ReAct）',
  '- 模型：`deepseek-v4-flash-0731` @ `jiyuan-lvdong`（`https://tokenrhythm.studio/v1`，openai-completions）— 冻结',
  '- 运行口径：`DSH_PERMISSION_MODE=workspace-write`（平台默认安全档，写限于工作区 + 私有 temp）、`DSH_TELEMETRY_DISABLED=1`、单任务超时 600s（事故 #5 修正）',
  '- 工作区：`os.tmpdir()` 下物料化（与仓库树隔离；首跑因 harness 泄漏判废，见 `results/void-*`）',
  '- 指标口径：Day 1 仅 wall-clock（token 计数插件侧暂不可得，OPEN-5 未决，降级口径见 EXPERIMENT.md §7）；session id 留档供后续 Gate 2/3 复盘',
  '- Gate 1（VGCR）判定：deterministic verifier 四条件（原 bug 不可复现 / 主干测试通过 / integrity / exports）',
  '',
  '| task | killer | Gate1 verdict | probe | trunk (pass/tests) | integrity | exports | src changed | wall s | session |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((row) => {
    const trunk = row.verify?.gates?.trunkTestsPass
    const trunkCell = trunk ? `${trunk.counts?.pass ?? '-'}/${trunk.counts?.tests ?? '-'}` : '-'
    return `| ${row.taskId} | ${row.killer ? 'yes' : 'no'} | ${row.verify?.verdict ?? 'ERROR'} | ${row.verify?.gates?.bugNotReproducible?.ok ? 'clean' : 'repro'} | ${trunkCell} | ${row.verify?.gates?.integrity?.ok ?? '-'} | ${row.verify?.gates?.exports?.ok ?? '-'} | ${row.srcFootprint?.changed?.length ?? '-'} | ${(row.elapsedMs / 1000).toFixed(1)} | ${row.sessionId ?? 'none'} |`
  }),
  '',
  '## 明细',
  '',
  ...rows.flatMap((row) => [
    `### ${row.taskId} — ${row.verify?.verdict ?? 'ERROR'}`,
    '',
    `- session: \`${row.sessionId ?? 'none'}\`；dsh exit=${row.dshExitCode}；prompt sha256=\`${row.promptSha256}\``,
    `- src 足迹（纪律证据）：changed=${JSON.stringify(row.srcFootprint?.changed ?? [])} added=${JSON.stringify(row.srcFootprint?.added ?? [])} deleted=${JSON.stringify(row.srcFootprint?.deleted ?? [])}`,
    `- probe: ${JSON.stringify(row.verify?.gates?.bugNotReproducible?.ok ?? null)}`,
    `- integrity violations: ${JSON.stringify(row.verify?.gates?.integrity?.violations ?? [])}`,
    `- export violations: ${JSON.stringify(row.verify?.gates?.exports?.violations ?? [])}`,
    '',
    '```',
    (row.outputTail ?? '').trimEnd() || '(no output)',
    '```',
    '',
  ]),
  `原始 JSON：${jsonPath.replace(resolve(switchbenchRoot, '../../..'), '.')}`,
].join('\n')
const mdPath = join(resultsDir, `run-${runStamp}.md`)
writeFileSync(mdPath, md, 'utf8')

const passed = rows.filter((row) => row.vgcrPass).length
console.log(`\n=== 汇总 ===`)
console.log(`Gate1 PASS: ${passed}/${rows.length}`)
console.log(`报告: ${mdPath}`)
console.log(`数据: ${jsonPath}`)
