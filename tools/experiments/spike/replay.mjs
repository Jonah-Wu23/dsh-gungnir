/**
 * spike/replay.mjs — 被动面离线重放校验（零 API 成本）。
 *
 * 把修复后的被动面逻辑（core dist 的纯函数）重放到已跑批的 session log 上，
 * 复现插件输入构造（tool/call 的 name+args、tool/result 的 text+isError），
 * 输出每 session 的 wrapup 评估结论，并与插件 ledger 已记录的 assessment 对照。
 *
 * 用途：跑批前验证实现正确性（不烧模型 token）；也是缺陷回归工具
 * （首轮批跑的 write-outside 相对路径 bug 即由此类重放暴露/验证）。
 *
 * 用法：node replay.mjs <results/spike-<ts>>/rows.jsonl [--verbose]
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { decodeSessionLog } from '../switchbench/src/baseline-log.mjs'
import {
  assessS1,
  emptyPassivePlane,
  observeToolEvent,
  recordCapture,
  recordCompletionClaim,
} from '../../../packages/core/dist/index.js'

const rowsPath = process.argv[2]
if (rowsPath === undefined) throw new Error('usage: node replay.mjs <rows.jsonl> [--verbose]')
const verbose = process.argv.includes('--verbose')
const rows = readFileSync(rowsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

const ledgerPath = join(homedir(), '.dsh', 'storages', 'gungnir_ledger.json')
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : null

function ledgerEventsFor(sessionId) {
  if (ledger === null || sessionId === null) return []
  const prefix = sessionId + '#'
  return Object.entries(ledger.tables?.events ?? {})
    .filter(([key]) => key.startsWith(prefix))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value)
}

function textOfBlocks(node) {
  const parts = []
  const walk = (value) => {
    if (typeof value === 'string') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value !== null && typeof value === 'object') {
      const dict = value
      if (typeof dict.text === 'string') parts.push(dict.text)
      if (dict.content !== undefined) walk(dict.content)
    }
  }
  walk(node)
  return parts.join('\n')
}

/** 从绝对路径集合推导 workspace root（共同前缀目录；相对路径不参与）。 */
function workspaceRootOf(absolutePaths) {
  if (absolutePaths.length === 0) return null
  const normalized = absolutePaths.map((p) => p.replace(/\\/g, '/'))
  let prefix = normalized[0]
  for (const path of normalized) {
    let i = 0
    while (i < prefix.length && i < path.length && prefix[i] === path[i]) i++
    prefix = prefix.slice(0, i)
  }
  const root = prefix.slice(0, prefix.lastIndexOf('/'))
  return root === '' ? null : root
}

const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'str_replace_editor', 'notebook_edit', 'copy', 'move', 'rm'])

function replaySession(events, sessionId) {
  // 构造结构事件流（与插件 tools/result 监听器同输入形状；args 从 tool/call 关联过来）
  const nameByCallId = new Map()
  const argsByCallId = new Map()
  const views = []
  const absolutePaths = []
  for (const event of events) {
    if (event.seq === undefined) continue
    const data = event.data ?? {}
    if (event.type === 'tool/call') {
      const callId = String(data.callId ?? '')
      const name = String(data.name ?? '')
      nameByCallId.set(callId, name)
      let args = {}
      try {
        args = JSON.parse(data.arguments ?? '{}')
      } catch {
        args = {}
      }
      argsByCallId.set(callId, args)
      if (WRITE_TOOLS.has(name)) {
        for (const key of ['file_path', 'path', 'old_path', 'new_path', 'src', 'dest']) {
          const value = args[key]
          if (typeof value === 'string' && value !== '' && /^[a-zA-Z]:[\\/]/.test(value)) {
            absolutePaths.push(value)
          }
        }
      }
      continue
    }
    if (event.type === 'tool/result') {
      const message = data.message ?? {}
      const callId = message.source?.callId
      if (typeof callId !== 'string') continue
      const name = nameByCallId.get(callId) ?? 'unknown-tool'
      const blocks = message.content ?? []
      const isError = Array.isArray(blocks) && blocks.some((block) => block?.isError === true)
      views.push({ name, callId, text: textOfBlocks(blocks), isError, args: argsByCallId.get(callId) ?? {} })
    }
  }
  const workspaceRoot = workspaceRootOf(absolutePaths) ?? 'C:/work/unknown'
  // 找到 update_goal(complete) 的结果事件位置 → wrapup 时刻截断（R2：不把
  // update_goal 之后的事后调查命令计入评估状态）
  let wrapupCut = views.length
  let claimedComplete = false
  for (const event of events) {
    if (event.type === 'tool/call' && event.data?.name === 'update_goal') {
      let args = {}
      try {
        args = JSON.parse(event.data.arguments ?? '{}')
      } catch {
        args = {}
      }
      if (args.action === 'complete') {
        claimedComplete = true
        // 该 call 的 result 事件位置 = 评估时刻
        const callId = String(event.data.callId ?? '')
        const idx = views.findIndex((v) => v.callId === callId)
        if (idx >= 0) wrapupCut = idx + 1
      }
    }
  }
  // 重放（修复后逻辑），截断于 wrapup 时刻
  let state = emptyPassivePlane()
  for (let i = 0; i < wrapupCut; i++) {
    const view = views[i]
    state = observeToolEvent(
      state,
      {
        type: 'tool/result',
        turn: 0,
        step: 0,
        name: view.name,
        callId: view.callId,
        text: view.text,
        isError: view.isError,
        ...(Object.keys(view.args).length > 0 ? { args: view.args } : {}),
      },
      workspaceRoot,
    ).state
  }
  // S2 capture（从 ledger 读取已记录的 capture）
  const ledgerEvents = ledgerEventsFor(sessionId)
  const captureEvent = ledgerEvents.find((e) => e.type === 'gungnir/capture')
  if (captureEvent !== undefined) {
    state = recordCapture(state, captureEvent.capture, {})
  }
  // wrapup 评估（S1；S2 校验需运行时 verify ctx，离线重放只算 S1）
  const s1Conflicts = claimedComplete ? assessS1(recordCompletionClaim(state)) : assessS1(state)
  const recorded = ledgerEvents.find((e) => e.type === 'gungnir/assessment')
  return {
    claimedComplete,
    s1Conflicts: s1Conflicts.map((c) => c.kind),
    s1ConflictRefs: s1Conflicts.map((c) => c.ref),
    recordedOutcome: recorded?.outcome ?? null,
    recordedConflicts: (recorded?.conflicts ?? []).map((c) => c.kind),
    captureRecorded: captureEvent !== undefined,
  }
}

const issues = []
let falsePositives = 0
let mismatches = 0
for (const row of rows.filter((r) => r.group === 'C2a' || r.group === 'C2b')) {
  if (row.sessionLogPath === undefined || !existsSync(row.sessionLogPath)) continue
  let events
  try {
    events = decodeSessionLog(row.sessionLogPath)
  } catch (error) {
    issues.push(`${row.group}-${row.taskId}: session decode failed: ${error.message}`)
    continue
  }
  const result = replaySession(events, row.sessionId)
  const line = `${row.group}-${row.taskId}: claimed=${result.claimedComplete} S1conflicts=[${result.s1Conflicts.join(',')}] recorded=${result.recordedOutcome} recordedConflicts=[${result.recordedConflicts.join(',')}] capture=${result.captureRecorded}`
  console.log(line)
  if (verbose && result.s1Conflicts.length > 0) {
    console.log('   refs:', result.s1ConflictRefs.join(' | '))
  }
  // 校验 1：正确完成任务（recorded=silent 或 success=true）不应有 S1 冲突
  if (result.recordedOutcome === 'silent' && result.s1Conflicts.length > 0) {
    falsePositives++
    issues.push(`${row.group}-${row.taskId}: FIXED-PLANE false positive — recorded=silent but S1 conflicts [${result.s1Conflicts.join(',')}]`)
  }
  // 校验 2：重放 S1 与 recorded 冲突一致（不变量事件来源相同；S2 冲突不在 S1 内）
  if (result.recordedOutcome === 'intervene') {
    const s1Recorded = result.recordedConflicts.filter((c) => !['artifact-missing', 'verify-command-failed', 'file-modified', 'new-deps'].includes(c))
    if (s1Recorded.length > 0 && result.s1Conflicts.join(',') !== s1Recorded.join(',')) {
      mismatches++
      issues.push(`${row.group}-${row.taskId}: replay S1 [${result.s1Conflicts.join(',')}] != recorded S1 [${s1Recorded.join(',')}]`)
    }
  }
}
console.log('')
console.log(`replayed ${rows.filter((r) => r.group === 'C2a' || r.group === 'C2b').length} C2 rows`)
console.log(`falsePositives (recorded=silent but S1 conflicts): ${falsePositives}`)
console.log(`S1 mismatches vs recorded: ${mismatches}`)
if (issues.length > 0) {
  console.log('ISSUES:')
  for (const issue of issues) console.log(' -', issue)
}
