/**
 * ve-supply/toollog.mjs — 从 DSH session log 提取结构事件序列 → ToolEventView JSONL
 * （@gungnir/core passive.ts 的 ToolEventView 形状：tool/call + tool/result；既是
 * S1 通用不变量的输入，也是 M-D grounding 检查的输入——checkGrounding 只消费
 * type/name/args 子集，超集无害）。
 *
 * 输入 = DSH session log（`session.jsonl.zstd`，多帧 zstd 容器；帧扫描语义按其公开
 * 解码器实现，见 tools/experiments/switchbench/src/baseline-log.mjs —— 此处为新产品
 * 独立实现，仅借鉴已实证的帧布局）。可直接传 session log 路径、session 目录、
 * 或工作区路径（按 cwd 编码目录反查最新 session）。
 *
 * 输出 = ToolEventView JSONL：tool/call 的 args 中读/写路径键
 * （file_path/path/old_path/new_path/src/dest）归一为工作区相对路径（大小写不敏感、
 * 统一正斜杠），使契约声明的 output/source（相对路径）能与事件精确匹配；
 * tool/result 的 name 按 callId 反查，text 从嵌套 content 展平，isError 透传。
 */
import { zstdDecompressSync } from 'node:zlib'
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ZSTD_MAGIC = 0xfd2fb528

/** 扫描拼接 zstd 帧的字节区间（DSH session 容器格式，语义同 baseline-log.mjs）。 */
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

/** 由工作区路径反查其最新 session 日志（cwd 编码目录；与 switchbench 反查口径一致）。 */
export function findSessionLogByWorkspace(workspacePath) {
  const sessionsRoot = join(homedir(), '.dsh', 'sessions')
  if (!existsSync(sessionsRoot)) return null
  const stamp = workspacePath.split(/[/\\]/).filter(Boolean)
  const tail = stamp.slice(-2).join('-')
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

/** 定位 session log：接受日志路径 / session 目录 / 工作区路径（反查）。 */
export function locateSessionLog(input, workspacePath) {
  if (typeof input === 'string' && input !== '') {
    const candidate = resolve(input)
    if (existsSync(candidate)) {
      if (candidate.endsWith('.zstd') || candidate.endsWith('.jsonl')) return { sessionId: null, logPath: candidate }
      // 目录：先按 session 目录（session-*/session.jsonl.zstd）找，找不到再按工作区反查
      if (statSync(candidate).isDirectory()) {
        for (const name of readdirSync(candidate)) {
          if (!name.startsWith('session-')) continue
          const p = join(candidate, name, 'session.jsonl.zstd')
          if (existsSync(p)) return { sessionId: name, logPath: p }
        }
      }
    }
  }
  if (workspacePath !== undefined && workspacePath !== '') {
    const found = findSessionLogByWorkspace(workspacePath)
    if (found !== null) return { sessionId: found.sessionId, logPath: found.logPath }
  }
  if (typeof input === 'string' && input !== '' && existsSync(input) && statSync(input).isDirectory()) {
    throw new Error(`toollog: no session.jsonl.zstd found for ${input} (not a session dir, and workspace reverse-lookup missed)`)
  }
  return null
}

/** 读/写路径键（与 core checkGrounding 的 pathOf 同口径）。 */
const PATH_KEYS = ['file_path', 'path', 'old_path', 'new_path', 'src', 'dest']

/** 归一：工作区内绝对路径 → 工作区相对（正斜杠）；已相对路径原样；区外绝对路径保留。 */
export function toWorkspaceRelative(raw, workspaceRoot) {
  if (typeof raw !== 'string' || raw === '') return raw
  const normalize = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = normalize(workspaceRoot)
  const candidate = normalize(raw)
  const isAbsolute = /^[a-zA-Z]:\//.test(candidate) || candidate.startsWith('/') || candidate.startsWith('//')
  if (isAbsolute) {
    const rootLower = root.toLowerCase()
    const candidateLower = candidate.toLowerCase()
    if (candidateLower.startsWith(rootLower)) {
      return candidate.slice(root.length).replace(/^\/+/, '')
    }
    return candidate // 工作区外绝对路径：原样保留（写越界检查据此识别）
  }
  return candidate.replace(/^\.\//, '')
}

/**
 * 递归展平 tool-result 嵌套 content 里的 text 字段（content[].content[].text 多层结构，
 * 语义同 switchbench baseline-log.mjs 的 flattenText）。
 */
function flattenText(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map((part) => flattenText(part)).join('\n')
  if (node !== null && typeof node === 'object') {
    if (typeof node.text === 'string') return node.text
    if (node.content !== undefined) return flattenText(node.content)
  }
  return ''
}

/** tool/result 的 isError 标记（content 各 part 任一 isError === true）。 */
function resultIsError(parts) {
  for (const part of parts ?? []) {
    if (part !== null && typeof part === 'object' && part.isError === true) return true
  }
  return false
}

/**
 * session log → ToolEventView[]（passive.ts 形状；args 路径归一为工作区相对）。
 * @returns {Array<{type:'tool/call'|'tool/result', turn:number, step:number, name:string, callId:string, text?:string, isError?:boolean, args?:Record<string,unknown>}>}
 */
export function sessionToToolEvents(events, workspaceRoot) {
  const nameByCallId = new Map()
  const result = []
  for (const event of events) {
    if (event.type === 'tool/call') {
      const name = event.data?.name
      if (typeof name !== 'string' || name === '') continue
      const callId = event.data?.callId ?? ''
      if (callId !== '') nameByCallId.set(callId, name)
      let args = {}
      try {
        args = JSON.parse(event.data?.arguments ?? '{}')
      } catch {
        args = {}
      }
      if (typeof args !== 'object' || args === null) args = {}
      const normalized = { ...args }
      for (const key of PATH_KEYS) {
        if (typeof normalized[key] === 'string') {
          normalized[key] = toWorkspaceRelative(normalized[key], workspaceRoot)
        }
      }
      result.push({ type: 'tool/call', turn: event.data?.turn ?? 0, step: event.data?.step ?? 0, name, callId, args: normalized })
      continue
    }
    if (event.type === 'tool/result') {
      const callId = event.data?.message?.source?.callId ?? ''
      const name = nameByCallId.get(callId) ?? 'unknown'
      const parts = event.data?.message?.content
      result.push({
        type: 'tool/result',
        turn: event.data?.turn ?? 0,
        step: event.data?.step ?? 0,
        name,
        callId,
        text: flattenText(parts),
        isError: resultIsError(parts),
      })
    }
  }
  return result
}

/** 写入 tool-log.jsonl（ToolEventView JSONL）。 */
export function writeToolLog(events, outPath) {
  writeFileSync(outPath, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8')
  return outPath
}

/** CLI：node toollog.mjs --session <path> [--workspace <dir>] [--out <path>] */
function main(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session') args.session = argv[++i]
    else if (argv[i] === '--workspace') args.workspace = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  const located = locateSessionLog(args.session ?? '', args.workspace ?? '')
  if (located === null) throw new Error('toollog: session log not found (pass --session path or --workspace)')
  const events = decodeSessionLog(located.logPath)
  const root = resolve(args.workspace ?? process.cwd())
  const toolEvents = sessionToToolEvents(events, root)
  const outPath = args.out ?? 'tool-log.jsonl'
  writeToolLog(toolEvents, outPath)
  console.log(`toollog: ${toolEvents.length} tool events (session=${located.sessionId ?? 'explicit'}) → ${outPath}`)
}

if (process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('/toollog.mjs')) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
