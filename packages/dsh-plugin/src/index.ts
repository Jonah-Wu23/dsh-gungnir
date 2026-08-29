import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type CommandObservation,
  type VerifyContext,
  GUNGNIR_ADAPTIVE_SERVICE,
  routerInputsOf,
  type GungnirAdaptiveService,
  type LoopRouterInputs,
} from '@gungnir/core'
import { AgentLedger, type KvChannel } from './ledger.ts'
import { ReconcileEngine } from './engine.ts'
import { buildDirective, buildVerifyDirective, directiveApplicable } from './prestep.ts'
import { PassivePlaneRuntime } from './passive-plane.ts'
import { registerCommands, registerTools, type AgentView, type CommandsView, type GoalsView, type SurfaceDeps, type ToolsView, type UserQuestionsView } from './surfaces.ts'
import { ExitCodeVerifier } from './verifiers/exit-code.ts'
import { ArtifactVerifier } from './verifiers/artifact.ts'
import { LlmRubricVerifier } from './verifiers/llm-rubric.ts'

/**
 * dsh-gungnir —— Gungnir 的 DSH 适配层（cordis 插件）。
 *
 * 装配边界：
 * - 接缝访问一律经窄结构视图 + 防御式解析（dsh-interface.md §10–§13 为形状权威）；
 *   解析失败 fail loud，绝不静默降级成假成功。
 * - ledger 走 ctx.storage（ADR-0006）；续轮交给 goal-round-driver（ADR-0007），
 *   本插件只做 pre-step 追加注入与轮末 reconcile。
 * - 不碰 agent-loop，不冒充 human authority（消息 source 恒为 plugin）。
 */

export const name = 'gungnir'

// tokenMeter（OPEN-5）：v0.1.2 base bundle 自带 token-meter 行，插件侧可直接注入
// ctx.tokenMeter 做请求/表面 token 测量（dsh-interface.md §16）。
export const inject = ['agents', 'commands', 'goals', 'llm', 'shell', 'storage', 'tokenMeter', 'tools', 'userQuestions']

export interface Config {
  workspaceRoot?: string
  maxGoalRounds?: number
  rubricProvider?: string
  rubricModel?: string
  rubricTimeoutMs?: number
  /** headless/实验模式：gungnir_submit_spec 跳过 ask-user 直接提交（启动者即授权人） */
  autoApproveSpec?: boolean
  /**
   * 被动面模式（三阶段 P1，ADR-0017）：
   * - 'off'：现役协议面（二阶段形态，C3 负对照）；
   * - 's1'：Passive Proof —— 仅 S1 通用不变量（C2a）；
   * - 's1+s2'：Passive Proof —— S1 + 一次性轻量捕获（C2b）。
   * passive != 'off' 时：不注册协议工具、不注入协议指令、wrapup 钩子评估 +
   * MAF 最小介入。
   */
  passive?: 'off' | 's1' | 's1+s2'
}

// schemastery 无 enum 类型：passive 用 string schema（default 'off'），运行时经
// normalizePassive 归一（Config 类型保持字面量联合）。
export const Config = z.object({
  workspaceRoot: z.string().default(process.cwd()),
  maxGoalRounds: z.number().default(64),
  rubricProvider: z.string().default('deepseek'),
  rubricModel: z.string().default('deepseek-chat'),
  rubricTimeoutMs: z.number().default(60_000),
  autoApproveSpec: z.boolean().default(false),
  passive: z.string().default('off'),
}) as z<Config>

/** passive 配置归一（schemastery 无 enum：string 进，运行时校验 + 归一）。 */
export function normalizePassive(value: unknown): 'off' | 's1' | 's1+s2' {
  if (value === 's1' || value === 's1+s2') return value
  return 'off'
}

// ---- 窄结构访问辅助（unknown-only，接缝形状见 dsh-interface.md） -------------------

type Dict = Record<string, unknown>

function asDict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null ? (value as Dict) : null
}

function pick(value: unknown, key: string): unknown {
  return asDict(value)?.[key]
}

/** cordis 事件监听（未 merge 类型包时的通用签名）。 */
function onAny(ctx: Context, eventName: string, handler: (...args: never[]) => unknown): void {
  const on = pick(ctx, 'on')
  if (typeof on !== 'function') throw new Error('ctx.on unavailable: not a cordis context?')
  ;(on as (name: string, listener: unknown) => unknown).call(ctx, eventName, handler)
}

function service(ctx: Context, key: string, required: true): Dict
function service(ctx: Context, key: string, required: false): Dict | null
function service(ctx: Context, key: string, required: boolean): Dict | null {
  const value = pick(ctx, key)
  if (value === undefined || value === null) {
    if (required) throw new Error(`ctx.${key} unavailable — add the providing package to this profile`)
    return null
  }
  return asDict(value)
}

/** ctx.storage → KvFacet 通道（backend.get/resolve('json') 与 storage.kv 多路径尝试）。 */
export function resolveKvChannel(ctx: Context): KvChannel {
  const storage = service(ctx, 'storage', true)
  const candidates: unknown[] = []
  const backend = asDict(storage['backend'])
  if (backend !== null) {
    for (const method of ['get', 'resolve', 'open']) {
      const fn = backend[method]
      if (typeof fn === 'function') {
        try {
          candidates.push((fn as (name: string) => unknown).call(backend, 'json'))
        } catch {
          // registry 可能按别的协议取后端——继续尝试其他路径，最终 fail loud
        }
      }
    }
    candidates.push(backend)
  }
  candidates.push(storage)
  for (const candidate of candidates) {
    const kv = pick(candidate, 'kv')
    if (asDict(kv) !== null && typeof asDict(kv)?.['open'] === 'function') {
      const kvFacet = kv as { open(descriptor: unknown): Promise<Dict> }
      let unit: Promise<Dict> | null = null
      const getUnit = (): Promise<Dict> => {
        // UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/（dsh-storage 实测，2026-08-28）：不允许连字符
        unit ??= kvFacet.open({ name: 'gungnir_ledger', version: 1, tables: ['events'], hasGlobal: true }) as Promise<Dict>
        return unit
      }
      const call = async (method: string, ...args: unknown[]): Promise<unknown> => {
        const u = await getUnit()
        const fn = u[method]
        if (typeof fn !== 'function') throw new Error(`KvUnit.${method} unavailable`)
        return (fn as (...a: unknown[]) => Promise<unknown>).apply(u, args)
      }
      return {
        async loadAll() {
          return (await call('loadAll')) as { tables: Record<string, Record<string, unknown>>; global: unknown }
        },
        async putRecord(table: string, key: string, value: unknown) {
          await call('putRecord', table, key, value)
        },
        async setGlobal(value: unknown) {
          await call('setGlobal', value)
        },
      }
    }
  }
  throw new Error('no KvFacet reachable via ctx.storage (tried backend.get/resolve/open("json"), storage.kv) — see ADR-0006')
}

/** 插件源消息（绝不冒充 human authority）。 */
function makePluginMessage(text: string): unknown {
  return {
    id: `gungnir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'gungnir', form: 'instructions' },
  }
}

/** 调用 ctx.shell harness 执行器（pwsh-sandbox）跑命令，绝不私开进程。
 * 将 ShellRunResult 映射为 verifier 需要的 CommandObservation；
 * 信号/启动失败折叠为 exitCode=1 并保留 stderr 原貌，让 ExitCodeVerifier 如实 FAIL。
 */
async function runShellCommand(ctx: Context, command: string, timeoutMs: number): Promise<CommandObservation> {
  const shell = service(ctx, 'shell', true)
  const resolveFn = shell['resolve']
  if (typeof resolveFn !== 'function') throw new Error('ctx.shell.resolve unavailable')
  const runFn = shell['run']
  if (typeof runFn !== 'function') throw new Error('ctx.shell.run unavailable')
  const spec = (resolveFn as (r: unknown) => unknown).call(shell, { command, timeoutMs })
  const result = await (runFn as (s: unknown) => Promise<unknown>).call(shell, spec)
  const resultDict = asDict(result)
  if (resultDict === null) throw new Error('ctx.shell.run returned non-object')

  // sandbox 事实：denied / runnerFailed 是策略拒绝或执行器故障，不是命令本身失败。
  // 抛错 → ExitCodeVerifier 落 INCONCLUSIVE（fail loud），绝不伪装成 FAIL/PASS。
  const sandbox = asDict(resultDict['sandbox'])
  if (sandbox !== null && (sandbox['denied'] === true || sandbox['runnerFailed'] === true)) {
    throw new Error(
      `sandbox blocked the command: mode=${String(sandbox['mode'])} denied=${String(sandbox['denied'])} runnerFailed=${String(sandbox['runnerFailed'])} enforcement=${String(sandbox['enforcement'])}`,
    )
  }
  const sandboxNote = sandbox === null ? '' : `sandbox mode=${String(sandbox['mode'])} denied=false enforcement=${String(sandbox['enforcement'])}\n`
  const exitCode = typeof resultDict['exitCode'] === 'number' ? resultDict['exitCode'] : null
  const stdout = asDict(resultDict['stdout'])?.['text'] ?? ''
  const stderr = asDict(resultDict['stderr'])?.['text'] ?? ''
  if (exitCode === null) {
    const signal = resultDict['signal']
    return { exitCode: 1, stdout: String(stdout), stderr: `${sandboxNote}signal=${String(signal)} ${String(stderr)}`.trim() }
  }
  return { exitCode, stdout: String(stdout), stderr: sandboxNote + String(stderr) }
}

// ---- apply ----------------------------------------------------------------------

export function apply(ctx: Context, config: Config): void {
  const log = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void => {
    const line = `[gungnir] ${message}${detail !== undefined ? ` :: ${safeJson(detail)}` : ''}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }

  function safeJson(value: unknown): string {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const kv = resolveKvChannel(ctx)
  const ledgerMap = new Map<string, AgentLedger>()
  const ledgerOpening = new Map<string, Promise<AgentLedger>>()
  // 并发去重：loop 事件/agent 生命周期/工具面会同时触发 open——
  // 必须共享同一个 in-flight promise，否则会出现双实例（各自 seq 计数）导致 fold 分叉
  const ensureLedger = (agentId: string): Promise<AgentLedger> => {
    const existing = ledgerMap.get(agentId)
    if (existing !== undefined) return Promise.resolve(existing)
    const opening = ledgerOpening.get(agentId)
    if (opening !== undefined) return opening
    const created = AgentLedger.open(agentId, kv).then((ledger) => {
      ledgerMap.set(agentId, ledger)
      ledgerOpening.delete(agentId)
      return ledger
    })
    ledgerOpening.set(agentId, created)
    return created
  }
  const directory = { get: (agentId: string) => ledgerMap.get(agentId) }

  const workspaceRoot = config.workspaceRoot ?? process.cwd()
  const verifyContext: VerifyContext = {
    workspaceRoot,
    async runCommand(command: string, timeoutMs: number): Promise<CommandObservation> {
      return runShellCommand(ctx, command, timeoutMs)
    },
    async readFile(path: string) {
      const { readFile } = await import('node:fs/promises')
      const { resolve, sep } = await import('node:path')
      const root = resolve(workspaceRoot)
      const target = resolve(root, path)
      if (target !== root && !target.startsWith(root + sep)) return null
      return readFile(target, 'utf8').catch(() => null)
    },
    async completeRubric(prompt: string): Promise<string> {
      const llm = service(ctx, 'llm', true)
      const streamFn = llm['stream']
      if (typeof streamFn !== 'function') throw new Error('ctx.llm.stream unavailable')
      const options = {
        provider: config.rubricProvider ?? 'deepseek',
        model: config.rubricModel ?? 'deepseek-chat',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }
      const stream = (streamFn as (o: unknown) => AsyncIterable<unknown>).call(llm, options)
      let text = ''
      for await (const chunk of stream) {
        const block = asDict(pick(chunk, 'block'))
        if (typeof block?.['text'] === 'string') {
          text += block['text']
          continue
        }
        if (typeof pick(chunk, 'text') === 'string') text += pick(chunk, 'text') as string
        else if (typeof pick(chunk, 'delta') === 'string') text += pick(chunk, 'delta') as string
      }
      return text
    },
    now: () => Date.now(),
  }

  const engine = new ReconcileEngine(directory, verifyContext, [new ExitCodeVerifier(), new ArtifactVerifier(), new LlmRubricVerifier()], {
    injectDirective: (agentId, text) => {
      const agent = findAgent(ctx, agentId)
      if (agent === null) {
        log('warn', `cannot inject directive: agent ${agentId} not live`)
        return
      }
      agent.inject(makePluginMessage(text))
    },
    log,
  })

  // ---- 被动面（三阶段 P1，ADR-0017）：passive != 'off' 时现役 ----------------------
  const passiveMode = normalizePassive(config.passive)
  const passiveRuntime = new PassivePlaneRuntime({
    ledgerOf: (agentId) => directory.get(agentId),
    ensureLedger,
    injectMessage: (agentId, text) => {
      const agent = findAgent(ctx, agentId)
      if (agent === null) {
        log('warn', `cannot inject MAF: agent ${agentId} not live`)
        return
      }
      agent.inject(makePluginMessage(text))
    },
    runCommand: (command, timeoutMs) => runShellCommand(ctx, command, timeoutMs),
    readFile: (path) => verifyContext.readFile(path),
    workspaceRoot,
    log,
  })

  const surfaceDeps: SurfaceDeps = {
    engine,
    ledgers: directory,
    goals: service(ctx, 'goals', true) as unknown as GoalsView,
    userQuestions: service(ctx, 'userQuestions', false) as unknown as UserQuestionsView | null,
    autoApproveSpec: config.autoApproveSpec === true,
    maxGoalRounds: config.maxGoalRounds ?? 64,
    log,
    ensureLedger,
    passive: passiveMode,
    passiveRuntime,
  }

  registerCommands(service(ctx, 'commands', true) as unknown as CommandsView, surfaceDeps)
  registerTools(service(ctx, 'tools', true) as unknown as ToolsView, surfaceDeps)

  // ---- Adaptive Loop 服务（Adapt 层 driver 经 ctx.get 读取；服务缺席 = 原生路径） ----
  const nativeInputs: LoopRouterInputs = {
    hasActiveSpec: false,
    hasCommittedAction: false,
    claimRecordedThisRound: false,
    machineVerifiableOutstanding: false,
  }
  const adaptiveService: GungnirAdaptiveService = {
    routerInputs(agentId: string): LoopRouterInputs {
      const ledger = directory.get(agentId)
      if (ledger === undefined) return nativeInputs
      return routerInputsOf(ledger.current)
    },
    // resume 场景：新 driver 实例从账本现值起步（不重发 from=null 的初始选定）
    currentLoopMode(agentId: string) {
      const ledger = directory.get(agentId)
      if (ledger === undefined) return null
      return ledger.current.loopMode
    },
  }
  const provide = pick(ctx, 'provide')
  if (typeof provide !== 'function') throw new Error('ctx.provide unavailable: not a cordis context?')
  ;(provide as (key: string, value: unknown) => void).call(ctx, GUNGNIR_ADAPTIVE_SERVICE, adaptiveService)

  const loopEventAgentId = (payload: unknown): string | null => {
    const agent = asDict(pick(asDict(payload), 'agent'))
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    return agentId
  }

  // loop 事件落账（ADR-0005 命名空间放开；driver 发 local 事件，Prove 层持有存储）
  onAny(ctx, 'gungnir-loop/transition', (...args: unknown[]) => {
    const payload = asDict(args[0])
    const agentId = loopEventAgentId(payload)
    if (agentId === null || payload === null) return
    void (async () => {
      const ledger = await ensureLedger(agentId)
      await ledger.append({
        type: 'gungnir/loop-transition',
        from: (pick(payload, 'from') as string | null) ?? null,
        to: String(pick(payload, 'to')),
        turn: Number(pick(payload, 'turn') ?? 0),
        step: Number(pick(payload, 'step') ?? 0),
        rule: String(pick(payload, 'rule')),
      })
    })().catch((error: unknown) => log('error', 'loop-transition append failed (ledger stays at last consistent event)', error))
  })

  onAny(ctx, 'gungnir-loop/state', (...args: unknown[]) => {
    const payload = asDict(args[0])
    const agentId = loopEventAgentId(payload)
    if (agentId === null || payload === null) return
    void (async () => {
      const ledger = await ensureLedger(agentId)
      // transitionsCount 由 ledger 在串行队列内按 fold 派生值盖章（单一真理）
      await ledger.appendLoopState({
        mode: String(pick(payload, 'mode')),
        turn: Number(pick(payload, 'turn') ?? 0),
        step: Number(pick(payload, 'step') ?? 0),
      })
    })().catch((error: unknown) => log('error', 'loop-state append failed (ledger stays at last consistent event)', error))
  })

  // 事件面：工具结果捕获 / 轮末 reconcile / goal 不一致报警 / pre-step 注入
  onAny(ctx, 'agent/created', (...args: unknown[]) => {
    const agent = asDict(args[0])
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    if (agentId === null) return
    void ensureLedger(agentId).catch((error: unknown) => log('error', `ledger open failed for ${agentId}`, error))
  })

  onAny(ctx, 'tools/result', (...args: unknown[]) => {
    const exec = asDict(args[0])
    const result = asDict(args[1])
    if (exec === null || result === null) return
    const agent = asDict(pick(exec, 'agent'))
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    if (agentId === null) return
    const view = {
      callId: String(pick(exec, 'callId') ?? 'unknown-call'),
      name: String(pick(exec, 'name') ?? 'unknown-tool'),
      content: (pick(result, 'content') as { type: string; text?: string }[] | undefined) ?? [],
      isError: result['isError'] === true,
      errorText: typeof pick(asDict(pick(result, 'error')), 'message') === 'string' ? (pick(asDict(pick(result, 'error')), 'message') as string) : undefined,
      value: result['value'],
    }
    void engine.captureToolResult(agentId, view).catch((error: unknown) => log('error', 'evidence capture failed', error))
    // 被动面（P1）：S1 不变量观察 + wrapup 评估（update_goal complete/blocked）
    if (passiveMode !== 'off') {
      const argumentsDict = asDict(pick(exec, 'arguments')) ?? {}
      const text = toolResultText(view.content)
      void passiveRuntime
        .onToolResult(agentId, { name: view.name, arguments: argumentsDict, text, isError: view.isError, callId: view.callId })
        .catch((error: unknown) => log('error', 'passive observation failed', error))
    }
  })

  onAny(ctx, 'agent/turn-stopping', (...args: unknown[]) => {
    const payload = asDict(args[0])
    const agent = asDict(pick(payload, 'agent'))
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    if (agentId === null) return
    void engine
      .runRoundEnd(agentId)
      .catch((error: unknown) => log('error', `round-end reconcile failed for ${agentId} (ledger stays at last consistent event)`, error))
    // OPEN-5：轮末 token 测量（ctx.tokenMeter.measure(session)，dsh-token-meter 0.1.2）。
    // 失败只报错不中断 reconcile 链路——测量是观测，不是裁决依据。
    const session = asDict(pick(agent, 'session'))
    const turn = typeof pick(payload, 'turn') === 'number' ? (pick(payload, 'turn') as number) : 0
    void (async () => {
      const meter = service(ctx, 'tokenMeter', true)
      const measure = meter['measure']
      if (typeof measure !== 'function' || session === null) throw new Error('ctx.tokenMeter.measure unavailable')
      const m = asDict(await (measure as (s: unknown) => unknown).call(meter, session))
      if (m === null) throw new Error('tokenMeter.measure returned non-object')
      log('info', `token-meter turn=${turn}: total=${String(m['totalTokens'])} surface=${String(m['surfaceTokens'])} baseline=${JSON.stringify(m['baseline'])}`)
    })().catch((error: unknown) => log('warn', `token measurement failed (turn ${turn})`, error))
  })

  onAny(ctx, 'goal/changed', (...args: unknown[]) => {
    const payload = asDict(args[0])
    const agent = asDict(pick(payload, 'agent'))
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    const change = asDict(pick(payload, 'change'))
    const goal = asDict(pick(change, 'goal'))
    const nativePhase = typeof pick(goal, 'phase') === 'string' ? (pick(goal, 'phase') as string) : null
    if (agentId === null || nativePhase === null) return
    const ledger = directory.get(agentId)
    const gungnirPhase = ledger?.current.phase ?? null
    const expectedNative =
      gungnirPhase === 'COMPLETE'
        ? 'complete'
        : gungnirPhase === 'BLOCKED' || gungnirPhase === 'NEEDS_HUMAN'
          ? 'blocked/paused'
          : null
    if (expectedNative !== null && nativePhase !== expectedNative && !nativePhase.startsWith(expectedNative.slice(0, 5))) {
      log('warn', `phase mismatch: gungnir=${gungnirPhase} expects native ${expectedNative}, but native goal is ${nativePhase} (alarm only — Gungnir never writes the native goal directly)`)
    }
  })

  onAny(ctx, 'agent/pre-step', async (...args: unknown[]) => {
    const payload = asDict(args[0]) as { agent?: unknown; messages?: unknown[]; turn?: number; step?: number } | null
    const next = args[1] as () => Promise<{ kind: string; messages?: unknown[] }>
    const decision = await next()
    if (payload === null || decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
    // 被动面（P1）：零协议注入——Agent 无感知，默认跑原生路径
    if (passiveMode !== 'off') return decision
    const agent = asDict(payload.agent)
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    if (agentId === null) return decision
    const ledger = directory.get(agentId)
    if (ledger === undefined) return decision
    const state = ledger.current
    const step = typeof payload.step === 'number' ? payload.step : 0
    // FAST（无 goal 工作在途）：零 Gungnir 注入——Baseline-Preserving（Default-to-cheap）。
    // driver 未接入 router 的旧 agent（无 currentMode）按 undefined 处理，保持旧行为。
    const mode = pick(agent, 'currentMode')
    if (mode === 'FAST') {
      log('info', `pre-step FAST: no injection (turn ${String(payload.turn)} step ${String(step)})`)
      return decision
    }
    const verify = mode === 'VERIFY' ? buildVerifyDirective(state) : null
    if (verify !== null) {
      log('info', `injecting VERIFY directive into agent ${agentId} (turn ${String(payload.turn)} step ${String(step)})`)
      return { kind: 'enter', messages: [...decision.messages, makePluginMessage(verify)] }
    }
    if (!directiveApplicable(state, step)) return decision
    const directive = buildDirective(state)
    if (directive === null) return decision
    log('info', `injecting reconcile directive into agent ${agentId} (turn ${String(payload.turn)} step ${String(step)})`)
    return { kind: 'enter', messages: [...decision.messages, makePluginMessage(directive)] }
  })
}

function findAgent(ctx: Context, agentId: string): AgentView | null {
  const agents = pick(ctx, 'agents')
  const get = typeof pick(agents, 'get') === 'function' ? (pick(agents, 'get') as (id: string) => unknown) : null
  if (get === null) return null
  const agent = get.call(agents, agentId)
  if (asDict(agent) === null) return null
  return agent as AgentView
}

/** 工具结果文本提取（递归展平 content[] 的 text 块；环境输出，非模型文本）。 */
function toolResultText(blocks: readonly { type: string; text?: string; content?: unknown }[]): string {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node !== null && typeof node === 'object') {
      const dict = node as Record<string, unknown>
      if (typeof dict['text'] === 'string') parts.push(dict['text'] as string)
      if (dict['content'] !== undefined) walk(dict['content'])
    }
  }
  walk(blocks)
  return parts.join('\n')
}
