import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type CommandObservation,
  type VerifyContext,
} from '@gungnir/core'
import { AgentLedger, type KvChannel } from './ledger.ts'
import { ReconcileEngine } from './engine.ts'
import { buildDirective, directiveApplicable } from './prestep.ts'
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

export const inject = ['agents', 'commands', 'goals', 'llm', 'storage', 'tools', 'userQuestions']

export interface Config {
  workspaceRoot?: string
  maxGoalRounds?: number
  rubricProvider?: string
  rubricModel?: string
  rubricTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().default(process.cwd()),
  maxGoalRounds: z.number().default(64),
  rubricProvider: z.string().default('deepseek'),
  rubricModel: z.string().default('deepseek-chat'),
  rubricTimeoutMs: z.number().default(60_000),
})

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
        unit ??= kvFacet.open({ name: 'gungnir-ledger', version: 1, tables: ['events'], hasGlobal: true }) as Promise<Dict>
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
  const ensureLedger = async (agentId: string): Promise<AgentLedger> => {
    const existing = ledgerMap.get(agentId)
    if (existing !== undefined) return existing
    const ledger = await AgentLedger.open(agentId, kv)
    ledgerMap.set(agentId, ledger)
    return ledger
  }
  const directory = { get: (agentId: string) => ledgerMap.get(agentId) }

  const workspaceRoot = config.workspaceRoot ?? process.cwd()
  const verifyContext: VerifyContext = {
    workspaceRoot,
    async runCommand(command: string, _timeoutMs: number): Promise<CommandObservation> {
      // 沙箱 authority 归 DSH 原 owner；harness 执行器接缝在 M4 实测前不私开进程。
      throw new Error(`command execution not wired (stage-1): "${command.slice(0, 80)}". Use artifact criteria or wait for the harness executor seam.`)
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

  const surfaceDeps: SurfaceDeps = {
    engine,
    ledgers: directory,
    goals: service(ctx, 'goals', true) as unknown as GoalsView,
    userQuestions: service(ctx, 'userQuestions', false) as unknown as UserQuestionsView | null,
    maxGoalRounds: config.maxGoalRounds ?? 64,
    log,
    ensureLedger,
  }

  registerCommands(service(ctx, 'commands', true) as unknown as CommandsView, surfaceDeps)
  registerTools(service(ctx, 'tools', true) as unknown as ToolsView, surfaceDeps)

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
  })

  onAny(ctx, 'agent/turn-stopping', (...args: unknown[]) => {
    const payload = asDict(args[0])
    const agent = asDict(pick(payload, 'agent'))
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    if (agentId === null) return
    void engine
      .runRoundEnd(agentId)
      .catch((error: unknown) => log('error', `round-end reconcile failed for ${agentId} (ledger stays at last consistent event)`, error))
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
    const agent = asDict(payload.agent)
    const agentId = typeof pick(agent, 'id') === 'string' ? (pick(agent, 'id') as string) : null
    if (agentId === null) return decision
    const ledger = directory.get(agentId)
    if (ledger === undefined) return decision
    const state = ledger.current
    const step = typeof payload.step === 'number' ? payload.step : 0
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
