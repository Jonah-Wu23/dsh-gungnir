/**
 * baseline-log.mjs — Baseline（普通 DSH）的 session log 解码与指标复盘。
 *
 * Day 5+ 的 Gate 2/3 对 Baseline 的口径（BENCHMARK.md §6）：session id 留档后从
 * `~/.dsh/sessions/` 反查，zstd 多帧容器（DSH session-persistence-jsonl 的拼接帧
 * 格式，帧扫描逻辑按其公开解码器语义实现）解出 JSONL 事件流。
 *
 * 已验证事实（Day 1 勘察）：session log 不含 token usage（v0.1.2 headless），
 * Baseline 的 token 指标不可得 → 降级口径（EXPERIMENT.md §7）：LLM rounds ≈
 * assistant/message 数、tool calls、wall-clock、TAP 测试名、命令序列。
 */
import { zstdDecompressSync } from 'node:zlib'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ZSTD_MAGIC = 0xfd2fb528

/** 扫描拼接 zstd 帧的字节区间（DSH session 容器格式）。 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (buffer.length - offset < 3) throw new Error('truncated block header')
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error('reserved block type')
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push([start, offset])
  }
  return frames
}

/** 解码整个 session log 为事件数组。 */
export function decodeSessionLog(filePath) {
  const buffer = readFileSync(filePath)
  const text = scanZstdFrames(buffer)
    .map(([start, end]) => zstdDecompressSync(buffer.subarray(start, end)).toString('utf8'))
    .join('')
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

/** 由 session id 定位 session.jsonl.zstd（cwd 编码目录下最新 mtime 的 session）。 */
export function locateSessionLog(sessionId) {
  const sessionsRoot = join(homedir(), '.dsh', 'sessions')
  if (!existsSync(sessionsRoot)) return null
  for (const dirName of readdirSync(sessionsRoot)) {
    const sessionDir = join(sessionsRoot, dirName, sessionId)
    if (existsSync(sessionDir)) {
      const logPath = join(sessionDir, 'session.jsonl.zstd')
      if (existsSync(logPath)) return logPath
    }
  }
  return null
}

/** 反查：给定工作区路径（含 run 戳），返回其 cwd 编码目录下最新 session 的 id 与日志路径。 */
export function findSessionByWorkspace(workspacePath) {
  const sessionsRoot = join(homedir(), '.dsh', 'sessions')
  if (!existsSync(sessionsRoot)) return null
  const stamp = workspacePath.split(/[/\\]/).filter(Boolean)
  const tail = stamp.slice(-2).join('-') // run-<ts>/<taskId>
  for (const dirName of readdirSync(sessionsRoot)) {
    if (!dirName.includes(tail.replace(/[^A-Za-z0-9-]/g, '-'))) continue
    const encodedPath = join(sessionsRoot, dirName)
    const candidates = readdirSync(encodedPath).filter((name) => name.startsWith('session-'))
    candidates.sort((a, b) => statSync(join(encodedPath, b)).mtimeMs - statSync(join(encodedPath, a)).mtimeMs)
    if (candidates.length > 0) {
      const logPath = join(encodedPath, candidates[0], 'session.jsonl.zstd')
      if (existsSync(logPath)) return { sessionId: candidates[0], logPath }
    }
  }
  return null
}

/**
 * 从 session log 重建每轮 LLM 请求的消息序列（离线 token 估计的输入）。
 *
 * 轮次边界：每个 assistant/message 事件代表一次请求的响应；其请求载荷 = 到该事件
 * 为止累积的消息数组（不含该 assistant 消息本身）。reasoning 部分不重发（与线格式
 * 行为一致），不进入重建。已知缺口：DSH 注入的 system prompt 与工具 schema 不在
 * session log 里 → 估计值为下界（报告口径）。
 * @returns {Array<{round: number, messages: Array<object>}>}
 */
export function reconstructPayloads(events) {
  const messages = []
  const rounds = []
  let round = 0
  for (const event of events) {
    if (event.type === 'user/message') {
      const text = flattenText(event.data?.message?.content ?? event.data?.content ?? '')
      if (text !== '') messages.push({ role: 'user', content: text })
      continue
    }
    if (event.type === 'assistant/message') {
      round += 1
      rounds.push({ round, messages: messages.map((message) => ({ ...message })) })
      const parts = event.data?.message?.content ?? []
      const text = parts.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
      const toolCalls = parts
        .filter((part) => part?.type === 'tool-call')
        .map((part) => ({
          id: part.id,
          type: 'function',
          function: { name: part.name, arguments: typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments ?? {}) },
        }))
      messages.push({
        role: 'assistant',
        ...(text !== '' ? { content: text } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    if (event.type === 'tool/result') {
      const callId = event.data?.message?.source?.callId
      const content = flattenText(event.data?.message?.content)
      if (callId !== undefined) messages.push({ role: 'tool', tool_call_id: callId, content })
      continue
    }
  }
  return rounds
}

const TOOL_CLASS = {
  read: 'read',
  glob: 'list',
  ls: 'list',
  str_replace_editor: (args) => (args?.command === 'view' ? 'read' : 'write'),
  write: 'write',
  edit: 'write',
  notebook_edit: 'write',
  bash: 'command',
  shell: 'command',
  pwsh: 'command',
  powershell: 'command',
  multiedit: 'write',
  task: 'other',
  todowrite: 'other',
}

/** 递归展平 tool-result 嵌套 content 里的 text 字段（content[].content[].text 多层结构）。 */
function flattenText(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map((part) => flattenText(part)).join('\n')
  if (node !== null && typeof node === 'object') {
    if (typeof node.text === 'string') return node.text
    if (node.content !== undefined) return flattenText(node.content)
  }
  return ''
}

function classifyTool(name, args) {
  const classifier = TOOL_CLASS[name]
  if (typeof classifier === 'function') return classifier(args)
  return classifier ?? 'other'
}

function toolPath(args) {
  return String(args?.path ?? args?.file_path ?? args?.notebook_path ?? '')
}

/**
 * Baseline 指标复盘（口径与 metrics.mjs 冻结口径对齐，token 项为 null）。
 * @param {Array<object>} events session log 事件
 * @param {object} [timing] {startedAtMs}
 */
export function summarizeBaselineSession(events, timing = {}) {
  const toolCallsEvents = events.filter((event) => event.type === 'tool/call')
  const assistantMessages = events.filter((event) => event.type === 'assistant/message')
  const resultByCallId = new Map()
  for (const event of events) {
    if (event.type === 'tool/result') {
      const callId = event.data?.message?.source?.callId
      if (callId !== undefined) resultByCallId.set(callId, event)
    }
  }

  const readPaths = new Set()
  const pendingWrites = new Set()
  const commandHistory = []
  let totalCalls = 0
  let wastedCalls = 0
  let firstUseful = null
  let llmBefore = 0
  let assistantIndex = 0
  let commandCount = 0
  const testNames = new Set()

  for (const event of events) {
    if (event.type === 'assistant/message') {
      assistantIndex += 1
      continue
    }
    if (event.type !== 'tool/call') continue
    const name = event.data?.name ?? ''
    let args = {}
    try {
      args = JSON.parse(event.data?.arguments ?? '{}')
    } catch {
      args = {}
    }
    const kind = classifyTool(name, args)
    if (kind === 'other') continue // todo 等非动作调用不计分母
    totalCalls += 1
    let useful = false
    let wasted = false
    if (kind === 'read') {
      const path = toolPath(args)
      if (path !== '' && readPaths.has(path)) wasted = true
      else if (path !== '') {
        useful = true
        readPaths.add(path)
      } else wasted = true
    } else if (kind === 'list') {
      if (firstUseful === null) useful = true
      else wasted = true
    } else if (kind === 'write') {
      useful = true
      pendingWrites.add(toolPath(args))
    } else if (kind === 'command') {
      commandCount += 1
      const command = String(args.command ?? args.cmd ?? '')
      const repeat = commandHistory.some((entry) => entry.command === command && entry.mutatedAny === false)
      if (repeat) wasted = true
      else useful = true
      commandHistory.push({ command, mutatedAny: pendingWrites.size > 0 })
      pendingWrites.clear()
      // 测试名提取：从 tool/result 的嵌套 content[] 文本字段拼出真实多行文本，
      // 兼容 TAP 与 node spec reporter 两种格式（与 metrics.collectTestNames 同口径）。
      const resultEvent = resultByCallId.get(event.data?.callId)
      const output = flattenText(resultEvent?.data?.message?.content)
      for (const match of output.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)) testNames.add(match[1].trim())
      for (const match of output.matchAll(/^[✔✖✗] (.+?) \([\d.]+(?:ms|s)\)\s*$/gm)) testNames.add(match[1].trim())
    }
    if (firstUseful === null && useful) {
      firstUseful = { t: event.time, toolCallsBefore: totalCalls - 1, llmCallsBefore: assistantIndex }
    }
    if (wasted) wastedCalls += 1
  }

  const firstTs = timing.startedAtMs ?? events.find((event) => event.time !== undefined)?.time ?? null
  const lastTs = [...events].reverse().find((event) => event.time !== undefined)?.time ?? null
  const endedNormally = events.some((event) => event.type === 'turn/end')

  return {
    wallMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : null,
    inputTokens: null, // v0.1.2 session log 不含 usage（实测，见文件头注）
    outputTokens: null,
    llmRoundTrips: assistantMessages.length,
    toolCalls: totalCalls,
    commandCount,
    ttfua: firstUseful === null ? null : {
      seconds: (firstUseful.t - firstTs) / 1000,
      llmCallsBefore: firstUseful.llmCallsBefore,
      toolCallsBefore: firstUseful.toolCallsBefore,
    },
    waste: { ratio: totalCalls === 0 ? 0 : wastedCalls / totalCalls, wasted: wastedCalls, total: totalCalls },
    claimedCompletion: endedNormally,
    finishReason: endedNormally ? 'session-ended' : 'incomplete',
    tests: { executed: [...testNames], scores: null }, // 计分由调用方用任务标注补
    tokenMetering: 'unavailable (v0.1.2 session log has no usage events)',
  }
}
