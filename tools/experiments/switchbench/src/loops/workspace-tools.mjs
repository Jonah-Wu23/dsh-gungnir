/**
 * workspace-tools.mjs — SwitchBench A/B 架构的工具面（两架构完全一致，公平性要求）。
 *
 * 工具面刻意最小（调查 + 修码 + 验证所需）：read_file / write_file / list_dir /
 * run_command / finish。与 Baseline（DSH 完整工具面）的口径差异在报告中注明；
 * H1 判决只看 A vs B，两架构共用本模块。
 *
 * 约束：
 * - 路径全部 jail 在工作区内（拒绝逃逸，作为 violation 记录，不静默）。
 * - A/B 运行不经过 DSH，因此没有 DSH 的 workspace-write 写沙箱：run_command 直接
 *   在本机以 workspace 为 cwd 执行（有超时与输出截断）。这是与 Baseline 的已知
 *   环境差异（Baseline 的 node --test 受 EPERM 限制，A/B 不受限），冻结 prompt 的
 *   环境注记两条路径都兼容，不构成 prompt 差异。报告中如实注明。
 * - 每次调用/结果都发事件（供 Gate 2/3 指标与纪律复盘）；不做任何语义猜测。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const COMMAND_TIMEOUT_MS = 90_000
const OUTPUT_LIMIT = 24_000
const FILE_READ_LIMIT = 120_000

/** OpenAI function-calling 形式的工具 schema（A/B 共用；finish 语义在描述内自明）。 */
export function toolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the full content of a file inside the workspace.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Workspace-relative or absolute path under the workspace' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a file inside the workspace with the given content.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative or absolute path under the workspace' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List the entries of a directory inside the workspace.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Directory path, "." for workspace root' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run a shell command with the workspace as the current working directory and return stdout, stderr and the exit code. Use it to run the test suite or node scripts.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'finish',
        description: 'Call this when the goal is achieved and you have verified it (test suite run and passing). Provide a short summary of what was wrong and what you changed.',
        parameters: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      },
    },
  ]
}

/**
 * 工具执行器。
 * @param {object} opts
 * @param {string} opts.workspace 工作区绝对路径
 * @param {(event: object) => void} opts.onEvent 事件 sink
 * @param {Set<string>} [opts.allowedTools] 限制可用工具集（strategy sub-conversation 用）；缺省全量
 * @param {object} [opts.sharedState] 跨执行器共享的观察态（同一 run 的多实例必须共享，
 *   否则纪律观察碎片化）；缺省自建。
 */
export class WorkspaceTools {
  constructor({ workspace, onEvent, allowedTools, sharedState }) {
    this.workspace = resolve(workspace)
    this.onEvent = onEvent ?? (() => {})
    this.allowedTools = allowedTools ?? null
    this.sharedState = sharedState ?? {
      observations: { pathViolations: [], commands: [], fileHashes: new Map(), mutatedSinceCommand: new Set() },
      seq: 0,
    }
    this.observations = this.sharedState.observations
    /** 纪律观察数据（供指标）：路径违规、执行过的命令、读过的文件内容 hash。 */
    this.seq = 0
  }

  /** 工作区 jail：解析路径并确认落在工作区内（工作区根目录本身合法）。 */
  jail(rawPath) {
    const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(join(this.workspace, rawPath))
    const rel = relative(this.workspace, target)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    return { target, rel: rel.split(sep).join('/') || '.' }
  }

  isAllowed(name) {
    return this.allowedTools === null || this.allowedTools.has(name)
  }

  /**
   * 执行一次工具调用。
   * @returns {Promise<{ok: boolean, output: string, violation?: string}>}
   */
  async execute(name, args) {
    this.sharedState.seq += 1
    this.seq = this.sharedState.seq
    const callSeq = this.seq
    this.onEvent({ type: 'tool-call', seq: callSeq, name, args: summarizeArgs(name, args) })
    if (!this.isAllowed(name)) {
      const violation = `tool '${name}' is not allowed in this phase`
      this.onEvent({ type: 'tool-result', seq: callSeq, name, ok: false, violation })
      return { ok: false, output: violation, violation }
    }
    try {
      const result = await this.executeInner(name, args, callSeq)
      // run_command 的输出进事件流（TAP 测试名提取与纪律复盘用；其余工具只记体量，
      // 避免把文件内容整体倒进日志）。
      this.onEvent({
        type: 'tool-result',
        seq: callSeq,
        name,
        ok: result.ok,
        violation: result.violation,
        outputBytes: result.output.length,
        exitCode: result.exitCode,
        ...(name === 'run_command' ? { output: result.output } : {}),
      })
      return result
    } catch (error) {
      const output = `tool error: ${error?.message ?? error}`
      this.onEvent({ type: 'tool-result', seq: callSeq, name, ok: false, error: output })
      return { ok: false, output }
    }
  }

  async executeInner(name, args, callSeq) {
    switch (name) {
      case 'read_file': {
        const jailed = this.jail(String(args?.path ?? ''))
        if (jailed === null) return this.pathViolation(String(args?.path ?? ''), callSeq)
        if (!existsSync(jailed.target) || !statSync(jailed.target).isFile()) {
          return { ok: false, output: `file not found: ${jailed.rel}` }
        }
        const content = readFileSync(jailed.target, 'utf8')
        this.trackFileHash(jailed.rel, content)
        const truncated = content.length > FILE_READ_LIMIT ? `${content.slice(0, FILE_READ_LIMIT)}\n... (truncated, ${content.length} chars total)` : content
        return { ok: true, output: truncated }
      }
      case 'write_file': {
        const jailed = this.jail(String(args?.path ?? ''))
        if (jailed === null) return this.pathViolation(String(args?.path ?? ''), callSeq)
        const content = String(args?.content ?? '')
        mkdirSync(dirname(jailed.target), { recursive: true })
        writeFileSync(jailed.target, content, 'utf8')
        this.trackFileHash(jailed.rel, content)
        this.observations.mutatedSinceCommand.add(jailed.rel)
        return { ok: true, output: `wrote ${jailed.rel} (${content.length} chars)` }
      }
      case 'list_dir': {
        const jailed = this.jail(String(args?.path ?? '.'))
        if (jailed === null) return this.pathViolation(String(args?.path ?? ''), callSeq)
        if (!existsSync(jailed.target) || !statSync(jailed.target).isDirectory()) {
          return { ok: false, output: `directory not found: ${jailed.rel}` }
        }
        const entries = readdirSync(jailed.target, { withFileTypes: true })
          .map((entry) => `${entry.isDirectory() ? 'd' : 'f'} ${entry.name}`)
          .join('\n')
        return { ok: true, output: entries === '' ? '(empty)' : entries }
      }
      case 'run_command':
        return this.runCommand(String(args?.command ?? ''), callSeq)
      case 'finish':
        return { ok: true, output: 'finish acknowledged', finishSummary: String(args?.summary ?? '') }
      default:
        return { ok: false, output: `unknown tool: ${name}` }
    }
  }

  runCommand(command, callSeq) {
    if (command.trim() === '') return { ok: false, output: 'empty command' }
    const record = { command, seq: callSeq, mutatedFiles: undefined }
    this.observations.commands.push(record)
    return new Promise((resolveSpawn) => {
      const child = spawn(command, {
        cwd: this.workspace,
        shell: true,
        env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, COMMAND_TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        if (stdout.length < OUTPUT_LIMIT) stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        if (stderr.length < OUTPUT_LIMIT) stderr += String(chunk)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        resolveSpawn({ ok: false, output: `spawn error: ${error.message}` })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        record.exitCode = code
        record.timedOut = timedOut
        record.mutatedFiles = [...this.observations.mutatedSinceCommand]
        this.observations.mutatedSinceCommand.clear()
        const combined = `exit ${code ?? 'null'}${timedOut ? ' (timed out after 90s)' : ''}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`.trim()
        const output = combined.length > OUTPUT_LIMIT ? `${combined.slice(0, OUTPUT_LIMIT)}\n... (output truncated)` : combined
        resolveSpawn({ ok: code === 0 && !timedOut, output, exitCode: code })
      })
    })
  }

  trackFileHash(rel, content) {
    this.observations.fileHashes.set(rel, { hash: createHash('sha256').update(content).digest('hex'), seq: this.seq })
  }

  pathViolation(rawPath, callSeq) {
    const violation = `path escapes the workspace: ${rawPath}`
    this.observations.pathViolations.push({ seq: callSeq, path: rawPath })
    this.onEvent({ type: 'violation', seq: callSeq, kind: 'path-escape', path: rawPath })
    return { ok: false, output: violation, violation }
  }
}

function summarizeArgs(name, args) {
  if (name === 'write_file') {
    return { path: args?.path, contentChars: String(args?.content ?? '').length }
  }
  if (name === 'run_command') return { command: args?.command }
  if (name === 'finish') return { summary: args?.summary }
  return args
}
