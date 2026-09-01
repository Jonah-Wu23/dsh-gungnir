import type { GoalSpec, SuccessCriterion } from './schema/spec.ts'
import type { ConflictDetail, S2Capture } from './schema/passive.ts'
import type { SuppliedProjection } from './contract.ts'

/**
 * 被动面（Passive Plane）域逻辑 —— 三阶段 P1（ADR-0017，Passive Proof Spike）。
 *
 * 全部纯函数（零 DSH 依赖）：S1 通用不变量派生、wrapup 评估、MAF 消息构建。
 * 运行面（事件监听、ctx.shell、inject）在 dsh-plugin。
 *
 * 触发器纪律（Let It Go 边界）：输入只吃结构事件——tool/call 的 name+args、
 * tool/result 的 isError + 内容文本（环境输出，非模型 claim）、update_goal 的
 * action 字段。严禁从模型文本识别"我完成了"。
 */

// ---- S1 通用不变量 -------------------------------------------------------------

export const S1_INVARIANT_IDS = ['tool-error', 'sandbox-denied', 'test-failure', 'write-outside-workspace'] as const
export type S1InvariantId = (typeof S1_INVARIANT_IDS)[number]

/** 沙箱拒绝标记（与 stage2 metrics 的 DENIAL_MARKERS 同口径，冻结）。 */
export const SANDBOX_DENIAL_MARKERS = ['denied', 'EPERM', 'WEB_BLOCKED'] as const

/**
 * 测试失败模式（tool/result 文本，环境输出）：node TAP/spec reporter、jest、
 * npm、tsc、常见探针错误。全部冻结于预注册；命中任一即 test-failure 警告。
 * 注意：`ℹ fail 0` / `# fail 0` 是"通过"输出，必须匹配非零失败数。
 */
export const TEST_FAILURE_PATTERNS: readonly RegExp[] = [
  /✖/,
  /ℹ fail [1-9]\d*/,
  /# fail [1-9]\d*/,
  /\bFAIL\b/,
  /npm ERR!/,
  /Error: /,
  /error TS\d+/,
  /command not found/,
]

/** "这是一次测试运行"的结构标记（用于判定 test-failure 的时序翻转）。 */
const TEST_RUN_MARKERS = ['✖', '✔', 'ℹ tests', '# tests', 'ok ', 'not ok'] as const

const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'multiedit', 'str_replace_editor', 'notebook_edit', 'copy', 'move', 'rm'])

/**
 * 命令执行类工具（S1 文本判读的唯一作用面）：只有这类工具的结果文本才做
 * denied/test-failure 标记解析。read/grep/write 等结果含 'denied'/'Error: ' 等
 * 字面量属于文件内容，不是执行信号（M2 修复：防 read 读到源码字面量误报）。
 */
export const COMMAND_TOOL_NAMES = new Set(['pwsh', 'bash', 'shell', 'powershell', 'cmd', 'run_code', 'exec', 'zsh', 'sh', 'pwsh-preview'])

/**
 * 沙箱升级被拒（策略边界探测，如 "sandbox escalation to ... is not strictly wider
 * than ..."）：EPERM 同类环境事实——agent 尝试升级沙箱权限被拒，属环境边界而非
 * 任务执行失败；按 ADR-0018 恢复语义（"EPERM 环境事实下 agent 就地消化后不误报"）
 * 不落 tool-error。离线判定实测触发：M5 glm 会话以一次被拒的升级尝试收尾，交付本身
 * 正确，S1 若按 tool-error 记会误杀健康交付。
 */
const ESCALATION_DENIAL_PATTERN = /sandbox escalation[\s\S]{0,200}(not strictly wider|requires approval)/i

export function isEscalationDenial(text: string): boolean {
  return ESCALATION_DENIAL_PATTERN.test(text)
}

/** 结构事件窄视图（插件监听器构造；纯函数输入）。 */
export interface ToolEventView {
  readonly type: 'tool/call' | 'tool/result'
  readonly turn: number
  readonly step: number
  readonly name: string
  readonly callId: string
  /** tool/result 有效；内容文本（环境输出） */
  readonly text?: string
  /** tool/result 有效 */
  readonly isError?: boolean
  /** tool/call 有效 */
  readonly args?: Record<string, unknown>
}

/** S1 不变量观测（一条事件可产多条；severity=warning 的时序翻转由评估层处理）。 */
export interface InvariantObservation {
  readonly invariantId: S1InvariantId
  readonly severity: 'error' | 'warning'
  readonly turn: number
  readonly step: number
  /** evidence locator：callId / 路径 / 命令串 */
  readonly ref: string
  readonly detail: string
}

export function isDeniedText(text: string): boolean {
  return SANDBOX_DENIAL_MARKERS.some((marker) => text.includes(marker))
}

export function hasTestFailureMarkers(text: string): boolean {
  return TEST_FAILURE_PATTERNS.some((pattern) => pattern.test(text))
}

export function isTestRunText(text: string): boolean {
  return TEST_RUN_MARKERS.some((marker) => text.includes(marker))
}

/** 写类工具的路径提取（file_path/path/old_path/new_path/src/dest 多键尝试）。 */
function pathFromArgs(args: Record<string, unknown>, workspaceRoot: string): { path: string; outside: boolean } | null {
  const candidates = ['file_path', 'path', 'old_path', 'new_path', 'src', 'dest']
  let raw: unknown = null
  for (const key of candidates) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') {
      raw = value
      break
    }
  }
  if (typeof raw !== 'string') return null
  return { path: raw, outside: !isInsideWorkspace(raw, workspaceRoot) }
}

/**
 * workspace 包含判定（Windows 大小写不敏感 + 统一分隔符）。
 * 相对路径按 workspace 相对解析后再判（`..` 逃逸会被识别为越界）。
 */
export function isInsideWorkspace(target: string, workspaceRoot: string): boolean {
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('/') || target.startsWith('\\\\')
  const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
  const root = normalize(workspaceRoot)
  let resolved: string
  if (isAbsolute) {
    resolved = target
  } else {
    resolved = workspaceRoot.replace(/\\/g, '/') + '/' + target
  }
  // 解析 .. 段（防 `../outside` 逃逸；同时保留大小写归一）
  const segments: string[] = []
  for (const segment of normalize(resolved).split('/')) {
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop()
      else segments.push(segment)
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment)
    }
  }
  const normalizedTarget = segments.join('/')
  if (normalizedTarget === root) return true
  return normalizedTarget.startsWith(root + '/')
}

/**
 * 单条结构事件 → 不变量观测（纯函数）。调用方（插件）负责传 workspaceRoot 与事件视图。
 * 写路径检查对 tool/call 与 tool/result 都生效（tools/result 的 exec 携带 arguments）。
 */
export function invariantsFromToolEvent(event: ToolEventView, workspaceRoot: string): InvariantObservation[] {
  const observations: InvariantObservation[] = []
  if (event.type === 'tool/result') {
    const text = event.text ?? ''
    if (event.isError === true) {
      observations.push({
        invariantId: 'tool-error',
        severity: 'error',
        turn: event.turn,
        step: event.step,
        ref: `call:${event.callId}#tool:${event.name}`,
        detail: `tool ${event.name} returned an error`,
      })
    }
    // 文本判读只对命令执行类工具（M2：read/grep 结果里的字面量不是执行信号）
    if (COMMAND_TOOL_NAMES.has(event.name)) {
      if (isDeniedText(text)) {
        observations.push({
          invariantId: 'sandbox-denied',
          severity: 'error',
          turn: event.turn,
          step: event.step,
          ref: `call:${event.callId}#tool:${event.name}`,
          detail: 'a command was blocked by the sandbox',
        })
      } else if (hasTestFailureMarkers(text)) {
        // 拒绝文本只计 sandbox-denied（不重复计 test-failure）
        observations.push({
          invariantId: 'test-failure',
          severity: 'warning',
          turn: event.turn,
          step: event.step,
          ref: `call:${event.callId}#tool:${event.name}`,
          detail: 'a test run reported failure markers',
        })
      }
    }
  }
  // 写类工具越界（两类事件都查：tool/call 与 tool/result 的 exec 都带 arguments）
  if (WRITE_TOOL_NAMES.has(event.name)) {
    const hit = pathFromArgs(event.args ?? {}, workspaceRoot)
    if (hit !== null && hit.outside) {
      observations.push({
        invariantId: 'write-outside-workspace',
        severity: 'error',
        turn: event.turn,
        step: event.step,
        ref: `call:${event.callId}#tool:${event.name}#path:${hit.path}`,
        detail: `wrote outside the workspace: ${hit.path}`,
      })
    }
  }
  return observations
}

// ---- 被动面观测状态（插件每 session 维护；纯函数推进） ---------------------------

export interface PassivePlaneState {
  /** 全部触发过的不变量（含 time-ordered；test-failure 可能被后续翻转） */
  readonly observations: readonly InvariantObservation[]
  /** 最近一次"测试运行"结果的判读：pass | fail | null（只有测试运行结果翻转） */
  lastTestRunOutcome: 'pass' | 'fail' | null
  /** 最近一次工具结果是否仍处于"拒绝/错误"态（任一干净结果清除——恢复语义） */
  lastProblem: 'sandbox-denied' | 'tool-error' | null
  /** BPAR v0.1（ADR-0022）：lastProblem === 'tool-error' 时的报错调用身份（结构事实，
   *  完成调用豁免判定的"事件类型 + action 字段 + 时序"三要素；零文本嗅探）。 */
  lastErrorTool: string | null
  lastErrorCallId: string | null
  lastErrorAction: string | null
  /** 已调 update_goal complete/blocked 的次数 */
  completionClaims: number
  /** 本次 session 的 S2 捕获（一次性；null = 未捕获） */
  capture: S2Capture | null
  /** S2 捕获时刻的文件快照（noModifyFiles/noNewDeps 的基线；插件注入） */
  readonly fileSnapshots: Readonly<Record<string, string>>
}

export function emptyPassivePlane(fileSnapshots: Readonly<Record<string, string>> = {}): PassivePlaneState {
  return {
    observations: [],
    lastTestRunOutcome: null,
    lastProblem: null,
    lastErrorTool: null,
    lastErrorCallId: null,
    lastErrorAction: null,
    completionClaims: 0,
    capture: null,
    fileSnapshots,
  }
}

/** 推进观测状态（纯函数）。返回 (newState, newObservations)。 */
export function observeToolEvent(state: PassivePlaneState, event: ToolEventView, workspaceRoot: string): { state: PassivePlaneState; observations: InvariantObservation[] } {
  const observations = invariantsFromToolEvent(event, workspaceRoot)
  let lastTestRunOutcome = state.lastTestRunOutcome
  let lastProblem = state.lastProblem
  let lastErrorTool = state.lastErrorTool
  let lastErrorCallId = state.lastErrorCallId
  let lastErrorAction = state.lastErrorAction
  if (event.type === 'tool/result') {
    const text = event.text ?? ''
    // 文本判读只对命令类工具（M2：read/grep 的输出文本不是执行信号）；
    // 但"干净结果恢复"对所有工具生效（任何成功的工具结果都代表恢复）
    const isCommand = COMMAND_TOOL_NAMES.has(event.name)
    const denied = isCommand && isDeniedText(text)
    const testRun = isCommand && isTestRunText(text)
    const testFailed = isCommand && hasTestFailureMarkers(text)
    if (denied) {
      // 拒绝优先（EPERM 等环境事实；测试运行也可能被拒）
      lastProblem = 'sandbox-denied'
      lastErrorTool = null
      lastErrorCallId = null
      lastErrorAction = null
    } else if (testRun) {
      // 测试运行判读优先于 isError：失败的测试运行记 lastTestRunOutcome=fail，
      // 不落 tool-error（避免双信号）
      lastTestRunOutcome = testFailed ? 'fail' : 'pass'
      if (!testFailed) {
        lastProblem = null
        lastErrorTool = null
        lastErrorCallId = null
        lastErrorAction = null
      }
    } else if (isCommand && isEscalationDenial(text)) {
      // 沙箱升级被拒 = 策略边界探测（EPERM 同类环境事实）：就地消化，恢复语义不误报
      lastProblem = null
      lastErrorTool = null
      lastErrorCallId = null
      lastErrorAction = null
    } else if (event.isError === true) {
      lastProblem = 'tool-error'
      // 报错调用身份（BPAR v0.1 豁免的"事件类型 + action 字段 + 时序"结构事实）
      lastErrorTool = event.name
      lastErrorCallId = event.callId
      const action = event.args?.['action']
      lastErrorAction = typeof action === 'string' ? action : null
    } else {
      // 干净结果（任何工具）：恢复语义——清除"拒绝/错误"态（测试失败只能被后续测试运行翻转）
      lastProblem = null
      lastErrorTool = null
      lastErrorCallId = null
      lastErrorAction = null
    }
  }
  return {
    state: {
      ...state,
      observations: [...state.observations, ...observations],
      lastTestRunOutcome,
      lastProblem,
      lastErrorTool,
      lastErrorCallId,
      lastErrorAction,
    },
    observations,
  }
}

export function recordCompletionClaim(state: PassivePlaneState): PassivePlaneState {
  return { ...state, completionClaims: state.completionClaims + 1 }
}

export function recordCapture(state: PassivePlaneState, capture: S2Capture, fileSnapshots: Readonly<Record<string, string>>): PassivePlaneState {
  return { ...state, capture, fileSnapshots }
}

// ---- wrapup 评估 ---------------------------------------------------------------

/** 完成类 action（update_goal 的 wrapup 触发面；core 独立声明，插件 WRAPUP_ACTIONS 同值）。 */
export const COMPLETION_ACTIONS = ['complete', 'blocked'] as const

/**
 * S1 完成调用豁免（BPAR v0.1，ADR-0022；P2 E2-gpt-H1-a 失分点修复）：
 * wrapup claim-check 评估到 lastProblem === 'tool-error' 时，若报错调用即 goal 完成
 * 声明调用本身（update_goal complete/blocked action），抑制该冲突——工具拒绝即完成
 * 未成立，错误对模型天然自明，无需 harness 提醒（MAF 冗余）。
 * 判定依据仅结构事实：事件类型（tool-error）+ action 字段 + 时序（报错调用 == 当前
 * 完成调用 callId），零文本嗅探（Let It Go 合规）。先例：isEscalationDenial。
 * 注意：豁免只发生在"完成调用自身报错"；其他调用未消化错误、SIG-2 重复失败签名、
 * sandbox-denied/test-failure/write-outside-workspace 均不豁免（照常拦）。
 */
export function isCompletionCallToolError(state: PassivePlaneState, completionCallId: string | undefined): boolean {
  if (state.lastProblem !== 'tool-error') return false
  if (state.lastErrorTool !== 'update_goal') return false
  if (state.lastErrorAction === null || !(COMPLETION_ACTIONS as readonly string[]).includes(state.lastErrorAction)) return false
  return state.lastErrorCallId === completionCallId
}

/** S1 评估上下文（BPAR v0.1）：wrapup 触发调用（update_goal complete/blocked）的 callId。 */
export interface S1AssessmentContext {
  readonly completionCallId?: string
}

/**
 * 纯评估：S1 不变量 → 冲突明细。
 * 时间序规则（冻结于预注册）：
 * - write-outside-workspace：任何一次即冲突（不可逆动作）；
 * - sandbox-denied / tool-error：最近结果仍处"拒绝/错误"态才冲突（干净结果清除——
 *   恢复语义，EPERM 环境事实下 agent 就地消化后不误报）；
 * - test-failure：最近一次测试运行判读为 fail 才冲突（后续 pass 翻转则不冲突）。
 * ctx.completionCallId 提供时应用"完成调用报错豁免"（ADR-0022）——报错调用即完成
 * 声明调用本身时抑制 tool-error 冲突；其余冲突照常。
 */
export function assessS1(state: PassivePlaneState, ctx: S1AssessmentContext = {}): ConflictDetail[] {
  const conflicts: ConflictDetail[] = []
  for (const observation of state.observations) {
    if (observation.invariantId !== 'write-outside-workspace') continue
    conflicts.push({ kind: observation.invariantId, ref: observation.ref, detail: observation.detail })
  }
  if (state.lastProblem === 'sandbox-denied') {
    const last = [...state.observations].reverse().find((observation) => observation.invariantId === 'sandbox-denied')
    conflicts.push({
      kind: 'sandbox-denied',
      ref: last?.ref ?? 'last-result',
      detail: 'the most recent command was blocked by the sandbox',
    })
  }
  if (state.lastProblem === 'tool-error' && !isCompletionCallToolError(state, ctx.completionCallId)) {
    const last = [...state.observations].reverse().find((observation) => observation.invariantId === 'tool-error')
    conflicts.push({
      kind: 'tool-error',
      ref: last?.ref ?? 'last-result',
      detail: 'the most recent tool call returned an error',
    })
  }
  if (state.lastTestRunOutcome === 'fail') {
    const last = [...state.observations].reverse().find((observation) => observation.invariantId === 'test-failure')
    conflicts.push({
      kind: 'test-failure',
      ref: last?.ref ?? 'last-test-run',
      detail: 'the most recent test run failed',
    })
  }
  return conflicts
}

/** S2 校验接口（插件注入：runCommand 走 ctx.shell，readFile 走 fence）。 */
export interface S2VerifyContext {
  /** 返回 exitCode；blocked=true 表示命令被沙箱拒绝/执行器故障（折为失败冲突，绝不静默） */
  runCommand(command: string, timeoutMs: number): Promise<{ exitCode: number; blocked?: boolean }>
  readFile(path: string): Promise<string | null>
  now(): number
}

/** 依赖清单文件名（noNewDeps 检查面，冻结）。 */
export const DEP_MANIFEST_NAMES = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'requirements.txt', 'pyproject.toml'] as const

/** S2 校验（异步；失败明细可多条）。 */
export async function assessS2(state: PassivePlaneState, ctx: S2VerifyContext): Promise<ConflictDetail[]> {
  const capture = state.capture
  if (capture === null) return []
  const conflicts: ConflictDetail[] = []
  for (const artifact of capture.expectedArtifacts) {
    const content = await ctx.readFile(artifact.path)
    if (artifact.mustExist && content === null) {
      conflicts.push({ kind: 'artifact-missing', ref: artifact.path, detail: `expected artifact ${artifact.path} is missing` })
      continue
    }
    if (!artifact.mustExist && content !== null) {
      conflicts.push({ kind: 'artifact-missing', ref: artifact.path, detail: `artifact ${artifact.path} must not exist but was found` })
      continue
    }
    if (artifact.contains !== undefined && content !== null && !content.includes(artifact.contains)) {
      conflicts.push({ kind: 'artifact-missing', ref: artifact.path, detail: `artifact ${artifact.path} does not contain expected content` })
    }
  }
  for (const command of capture.verifyCommands) {
    const result = await ctx.runCommand(command.command, command.timeoutMs)
    if (result.exitCode !== command.expectedExitCode) {
      conflicts.push({
        kind: 'verify-command-failed',
        ref: command.command,
        // MAF 不回显命令串（泄题纪律：命令文本只进 ledger/ref，不进模型可见 detail）
        detail: result.blocked === true
          ? `verification command was blocked by the sandbox (exit ${result.exitCode})`
          : `verification command failed (exit ${result.exitCode}, expected ${command.expectedExitCode})`,
      })
    }
  }
  for (const file of capture.constraints.noModifyFiles) {
    const baseline = state.fileSnapshots[file]
    if (baseline === undefined) continue
    const current = await ctx.readFile(file)
    if (current !== baseline) {
      conflicts.push({ kind: 'file-modified', ref: file, detail: `file ${file} was modified but the task forbids it` })
    }
  }
  if (capture.constraints.noNewDeps) {
    for (const manifest of DEP_MANIFEST_NAMES) {
      const baseline = state.fileSnapshots[manifest]
      if (baseline === undefined) continue
      const current = await ctx.readFile(manifest)
      if (current !== baseline) {
        conflicts.push({ kind: 'new-deps', ref: manifest, detail: `dependency manifest ${manifest} changed; the task forbids new dependencies` })
      }
    }
  }
  return conflicts
}

/** wrapup 总评估：S1（纯）+ S2（异步）。 */
export async function assessWrapup(state: PassivePlaneState, ctx: S2VerifyContext): Promise<ConflictDetail[]> {
  const conflicts = assessS1(state)
  if (state.capture !== null) {
    conflicts.push(...(await assessS2(state, ctx)))
  }
  return conflicts
}

// ---- 运行期契约 claim-check（三阶段 P2，ADR-0021 BPAR v0；P2-0②） ------------------
//
// 把离线法官（ve-supply adjudicate）的契约判据裁决搬进 session：wrapup 结构钩子处
// 对派发契约的 supplied 投影逐判据跑确定性检查（L1 exit_code 走 ctx.shell、L2 artifact
// 走 fence 读），M-C（unverifiable 三态）进被动面。冲突即 SIG-1 触发源（拦下完成宣称）。

/** 沙箱兼容命令变换（预注册，C2b 教训 + 沙箱 EPERM 事实）：本沙箱 `node --test` 默认
 *  isolation 会为每个测试文件 spawn 子进程而被拒（EPERM）；等价验证 `--test-isolation
 *  =none` 单进程内跑，判读结果一致。变换确定性、窄匹配、可审计（detailRef 保留原样）。 */
export function sandboxCompatCommand(command: string): string {
  if (/^node\s+--test(\s|$)/.test(command) && !command.includes('--test-isolation')) {
    return command.replace(/^node\s+--test/, 'node --test --test-isolation=none')
  }
  return command
}

export interface ContractCriterionOutcome {
  readonly id: string
  readonly kind: 'exit_code' | 'artifact'
  readonly outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  readonly detailRef: string
}

export interface ContractAssessment {
  readonly outcomes: ContractCriterionOutcome[]
  readonly conflicts: ConflictDetail[]
  readonly unverifiableIds: string[]
  /** 存在沙箱外判据 → 终局非完全 PASS（M-C 三态；模型不得宣称完全完成） */
  readonly finalNotFullyPass: boolean
}

/** 契约判据裁决（S2VerifyContext 复用：runCommand 走 ctx.shell、readFile 走 fence）。 */
export async function assessContractCriteria(supplied: SuppliedProjection, ctx: S2VerifyContext): Promise<ContractAssessment> {
  const outcomes: ContractCriterionOutcome[] = []
  const conflicts: ConflictDetail[] = []
  for (const criterion of supplied.criteria) {
    if (criterion.verifierLevel === 1 && criterion.predicate.kind === 'exit_code') {
      const command = sandboxCompatCommand(criterion.predicate.command)
      const timeoutMs = criterion.predicate.timeoutMs ?? 120_000
      const result = await ctx.runCommand(command, timeoutMs)
      const passed = result.exitCode === criterion.predicate.expectedExitCode
      outcomes.push({ id: criterion.id, kind: 'exit_code', outcome: passed ? 'PASS' : 'FAIL', detailRef: `cmd:${command}` })
      if (!passed) {
        conflicts.push({
          kind: 'verify-command-failed',
          ref: command,
          // MAF 不回显命令串（泄题纪律：变换后命令是 C-1 bait 的等价路径，只进 ref 不进 detail）
          detail: result.blocked === true
            ? `verification command was blocked by the sandbox (exit ${result.exitCode})`
            : `verification command failed (exit ${result.exitCode}, expected ${criterion.predicate.expectedExitCode})`,
        })
      }
    } else if (criterion.verifierLevel === 2 && criterion.predicate.kind === 'artifact') {
      const predicate = criterion.predicate
      const content = await ctx.readFile(predicate.path)
      const present = content !== null
      const ok = predicate.mustExist
        ? present && (predicate.contains === undefined ? true : (content as string).includes(predicate.contains))
        : !present
      outcomes.push({ id: criterion.id, kind: 'artifact', outcome: ok ? 'PASS' : 'FAIL', detailRef: `path:${predicate.path}` })
      if (!ok) {
        conflicts.push({
          kind: 'artifact-missing',
          ref: predicate.path,
          detail: predicate.mustExist
            ? predicate.contains !== undefined
              ? `artifact ${predicate.path} does not contain expected content`
              : `expected artifact ${predicate.path} is missing`
            : `artifact ${predicate.path} must not exist but was found`,
        })
      }
    } else {
      outcomes.push({ id: criterion.id, kind: criterion.predicate.kind === 'artifact' ? 'artifact' : 'exit_code', outcome: 'INCONCLUSIVE', detailRef: 'no deterministic verifier for this predicate on the runtime claim-check path' })
    }
  }
  const unverifiableIds = (supplied.unverifiableCriteria ?? []).map((criterion) => criterion.id)
  const finalNotFullyPass = unverifiableIds.length > 0
  return { outcomes, conflicts, unverifiableIds, finalNotFullyPass }
}

/** M-C 三态进被动面：存在沙箱外判据时，宣称完全完成 = 冲突（unverifiable-claim）。 */
export function unverifiableConflicts(supplied: SuppliedProjection): ConflictDetail[] {
  const criteria = supplied.unverifiableCriteria ?? []
  return criteria.map((criterion) => ({
    kind: 'unverifiable-claim' as const,
    ref: criterion.id,
    detail: `criterion ${criterion.id} (${criterion.description}) is not verifiable in this environment — claiming full completion while it is unverifiable is not allowed; mark the goal blocked or state the unverifiable criterion explicitly`,
  }))
}

// ---- MAF 消息（AP-6：任务层事实，零控制面内部概念） -----------------------------

const MAF_BY_KIND: Record<ConflictDetail['kind'], (conflict: ConflictDetail) => string> = {
  'sandbox-denied': (conflict) => `a command was blocked by the sandbox (${conflict.ref}). Re-run it inside the workspace with allowed permissions.`,
  'tool-error': (conflict) => `a tool call failed (${conflict.ref}). Check the reported error and retry.`,
  'test-failure': (conflict) => `your most recent test run failed (${conflict.ref}). Fix the failing test before claiming completion.`,
  'write-outside-workspace': (conflict) => `a file was written outside the workspace (${conflict.ref}). Keep all output inside the workspace.`,
  'artifact-missing': (conflict) => conflict.detail,
  'verify-command-failed': (conflict) => conflict.detail,
  'file-modified': (conflict) => conflict.detail,
  'new-deps': (conflict) => conflict.detail,
  'probe-failed': (conflict) => conflict.detail,
  'unverifiable-claim': (conflict) => conflict.detail,
}

export function buildMafMessage(conflicts: readonly ConflictDetail[]): string {
  const lines = conflicts.map((conflict) => `- ${MAF_BY_KIND[conflict.kind](conflict)}`)
  return [
    'Evidence conflicts with completing this task:',
    ...lines,
    'Resolve the conflicts above before claiming completion (if the goal is already complete, fix the underlying issue or state the resolving evidence in your reply).',
  ].join('\n')
}

// ---- L4 禁用守卫（ADR-0017 第 5 条；D1 修复） -----------------------------------

export function l4CriteriaOf(spec: GoalSpec): SuccessCriterion[] {
  return spec.successCriteria.filter((criterion) => criterion.verifierLevel >= 4 || criterion.predicate.kind === 'llm_rubric')
}

/** 提交路径守卫：含 L4（llm_rubric / verifierLevel≥4）的 spec 拒绝提交，给出明确原因。 */
export function assertNoL4(spec: GoalSpec): void {
  const offenders = l4CriteriaOf(spec)
  if (offenders.length > 0) {
    const ids = offenders.map((criterion) => criterion.id).join(', ')
    throw new Error(
      `L4 (llm_rubric) is disabled on this path (ADR-0017): criterion [${ids}] uses verifierLevel>=4. Use L1 (exit_code) or L2 (artifact) predicates instead.`,
    )
  }
}
