import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, StreamChunk, TokenUsage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as goalServiceModule from '@deepseek-ai/dsh-goal'
import * as goalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import * as toolGoal from '@deepseek-ai/dsh-tool-goal'
import * as sessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import GungnirLoop, { MAX_MODE_TRANSITIONS_PER_TURN } from '../../../packages/agent-loop/dist/index.js'
import type { LoopRouterInputs } from '@gungnir/core'
import { foldEvents, routerInputsOf } from '../../../packages/core/dist/index.js'
import { AgentLedger, MemoryKv, parseLedgerRecords } from '../../../packages/dsh-plugin/dist/ledger.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 确定性探针（二阶段 M1）：真实 DSH 栈（testkit 挂载 llm/session/system-prompt/tools/agents
 * + goal/goal-round-driver/tool-goal/persistence）+ 真 AdaptiveLoopAgent driver，仅模型是
 * 脚本化的（内容分派 chunk 流，不依赖时序）。覆盖：
 * - ② wrapup 时序（goal-round 权限路径：<goal_complete> deferContext 落盘时序，v0.1.2 行为）
 * - D-12 高频振荡注入（transition budget 拦截，ADR-0015 阈值）
 * - D-13 resume 后续跑（账本轨迹续写正确、无重复初始选定、request/header resume）
 * （D-11 前缀闭合见 packages/core/tests/loop-fold.test.ts；真实 profile 集成为主证据，
 *  见 docs/context/state.md 工作块记录。）
 */

/** 探针用的 session event 弱类型视图（只读形状，字段名与 dsh-session 事件词汇一致）。 */
interface ProbeEvent {
  type: string
  seq: number
  data: {
    turn?: number
    step?: number
    name?: string
    reason?: { kind?: string }
    message?: { content?: Array<{ type: string; text?: string }>; source?: { plugin?: string } }
  }
}

interface ProbeAgentView {
  id: string
  session: { events: ReadonlyArray<ProbeEvent> }
}

const USAGE: TokenUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

function textResponse(text: string): { chunks: StreamChunk[] } {
  return {
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: USAGE },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
}

function toolCallResponse(id: string, name: string, args: unknown): { chunks: StreamChunk[] } {
  const json = JSON.stringify(args)
  const block = { type: 'tool-call' as const, id: id as ToolCallId, name, arguments: json } as ContentBlock
  return {
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: id as ToolCallId, name, argumentsDelta: json },
      { type: 'block-end', index: 0, block },
      { type: 'usage', usage: USAGE },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

type ScriptedDecider = (options: GenerateOptions, callIndex: number) => { chunks: StreamChunk[] }

class ScriptedAdapter extends LlmAdapter {
  public calls = 0
  constructor(private readonly decider: ScriptedDecider) {
    super()
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = this.decider(options, this.calls++)
    for (const chunk of response.chunks) yield chunk
  }
}

/** 未装载事件类型合并时的通用监听（与 dsh-gungnir 插件的 onAny 同款）。 */
function onAny(ctx: Context, eventName: string, handler: (payload: unknown) => void): void {
  const on = (ctx as unknown as Record<string, unknown>)['on']
  if (typeof on !== 'function') throw new Error('ctx.on unavailable')
  ;(on as (name: string, listener: (...args: never[]) => unknown) => unknown).call(ctx, eventName, handler as never)
}

function provide(ctx: Context, key: string, value: unknown): void {
  const provideFn = (ctx as unknown as Record<string, unknown>)['provide']
  if (typeof provideFn !== 'function') throw new Error('ctx.provide unavailable')
  ;(provideFn as (key: string, value: unknown) => void).call(ctx, key, value)
}

function userTextOf(message: unknown): string {
  const m = message as { role?: string; content?: Array<{ type: string; text?: string }> }
  if (m?.role !== 'user' || !Array.isArray(m.content)) return ''
  return m.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

function allToolResultText(options: GenerateOptions): string {
  const found: string[] = []
  for (const message of options.messages) {
    const m = message as { role?: string; content?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> }
    if (m?.role !== 'user' || !Array.isArray(m.content)) continue
    for (const block of m.content) {
      if (block.type !== 'tool-result' || !Array.isArray(block.content)) continue
      found.push(block.content.map(inner => (inner.type === 'text' ? inner.text : '')).join(''))
    }
  }
  return found.join('\n')
}

/** user/message 事件的 data 就是 message 本体（无 .message 包裹）；其余事件取 .message。 */
function eventText(event: ProbeEvent): string {
  const content = event.data.message?.content
    ?? (event.data as unknown as { content?: Array<{ type: string; text?: string }> }).content
    ?? []
  return content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

function eventSourcePlugin(event: ProbeEvent): string | undefined {
  return event.data.message?.source?.plugin
    ?? (event.data as unknown as { source?: { plugin?: string } }).source?.plugin
}

async function wireLedger(ctx: Context): Promise<{
  ledger: AgentLedger
  kv: MemoryKv
  transitions: Array<{ from: string | null; to: string; turn: number; step: number; rule: string }>
}> {
  const kv = new MemoryKv()
  const ledger = await AgentLedger.open('probe', kv)
  const transitions: Array<{ from: string | null; to: string; turn: number; step: number; rule: string }> = []
  onAny(ctx, 'gungnir-loop/transition', (raw) => {
    const payload = raw as { from: string | null; to: string; turn: number; step: number; rule: string }
    void ledger.append({
      type: 'gungnir/loop-transition',
      from: payload.from,
      to: payload.to,
      turn: payload.turn,
      step: payload.step,
      rule: payload.rule,
    })
    transitions.push({ ...payload })
  })
  onAny(ctx, 'gungnir-loop/state', (raw) => {
    const payload = raw as { mode: string; turn: number; step: number }
    void ledger.appendLoopState({ mode: payload.mode, turn: payload.turn, step: payload.step })
  })
  provide(ctx, 'gungnirAdaptive', {
    routerInputs: () => routerInputsOf(ledger.current),
    currentLoopMode: () => ledger.current.loopMode,
  })
  return { ledger, kv, transitions }
}

/** 探针收尾（Context.dispose 未进类型面，运行时存在）。 */
async function disposeCtx(ctx: Context): Promise<void> {
  const dispose = (ctx as unknown as Record<string, unknown>)['dispose']
  if (typeof dispose === 'function') await (dispose as () => Promise<void>).call(ctx)
}

/** 未类型化的插件挂载（cordis plugin 泛型对 JS 模块对象过严，探针用窄通道）。 */
async function plug(ctx: Context, mod: unknown, config?: unknown): Promise<void> {
  const pluginFn = (ctx as unknown as Record<string, unknown>)['plugin']
  if (typeof pluginFn !== 'function') throw new Error('ctx.plugin unavailable')
  await (pluginFn as (p: unknown, c?: unknown) => Promise<unknown>).call(ctx, mod, config)
}

async function mountGoalStack(ctx: Context): Promise<void> {
  await plug(ctx, goalServiceModule.default)
  await plug(ctx, goalRoundDriver)
  await plug(ctx, toolGoal, {})
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** 目标脚本：turn1 create_goal → 收尾；goal-round turn → update_goal(complete) → 收尾。 */
const goalCompleteDecider: ScriptedDecider = (options) => {
  const transcript = JSON.stringify(options.messages)
  if (transcript.includes('<goal_complete>')) return textResponse('Goal is complete. Closing message to the user.')
  if (options.messages.some(message => userTextOf(message).includes('<goal_round>'))) {
    const goalResult = allToolResultText(options)
    const idMatch = goalResult.match(/"id"\s*:\s*"([^"]+)"/)
    const revisionMatch = goalResult.match(/"revision"\s*:\s*(\d+)/)
    if (idMatch !== null && revisionMatch !== null) {
      return toolCallResponse('call-update', 'update_goal', {
        goal_id: idMatch[1],
        revision: Number(revisionMatch[1]),
        action: 'complete',
      })
    }
    return toolCallResponse('call-getgoal', 'get_goal', {})
  }
  if (transcript.includes('create_goal')) return textResponse('Goal created. Ending the turn.')
  return toolCallResponse('call-create', 'create_goal', { objective: 'probe objective' })
}

describe('loop driver deterministic probes (real DSH stack, scripted model)', () => {
  it('② wrapup timing: <goal_complete> lands before the closing step; turn-stopping never fires early', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await mountGoalStack(ctx)
    await plug(ctx, GungnirLoop, { agents: [] })
    ctx.llm.registerAdapter(['scripted'], new ScriptedAdapter(goalCompleteDecider))

    const errorsSeen: string[] = []
    onAny(ctx, 'agent/error', (raw) => {
      const payload = raw as { agent?: { id?: unknown }; turn?: unknown; step?: unknown; error?: unknown }
      errorsSeen.push(`turn=${String(payload.turn)} step=${String(payload.step)} error=${String(payload.error)}`)
    })
    const stoppings: Array<{ turn: number; sawWrapup: boolean }> = []
    onAny(ctx, 'agent/turn-stopping', (raw) => {
      const payload = raw as { agent: ProbeAgentView; turn: number }
      const sawWrapup = payload.agent.session.events.some(event =>
        event.type === 'user/message' && eventText(event).includes('<goal_complete>'),
      )
      stoppings.push({ turn: payload.turn, sawWrapup })
    })

    const { agent } = await ctx.agents.create({
      sessionId: `probe-wrapup-${Date.now()}` as never,
      agentOptions: { provider: 'scripted', model: 'probe-model' },
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'probe: create a goal, then complete it on the next goal round' }],
      source: { kind: 'user' },
    }))
    await waitFor(() => agent.session.events.filter(event => event.type === 'turn/end').length >= 2, 15_000, 'two turns').catch((error: unknown) => {
      const summary = (agent.session.events as ReadonlyArray<ProbeEvent>).map(event => `${event.seq}:${event.type}`).join(', ')
      const goalState = JSON.stringify((ctx as unknown as { goals: { get(a: unknown): unknown } }).goals.get(agent))
      throw new Error(`${String(error)} :: events=[${summary}] :: goal=${goalState} :: status=${agent.status} :: agentErrors=${errorsSeen.join(' | ')}`)
    })

    const events = agent.session.events as ReadonlyArray<ProbeEvent>
    const updateGoalCall = events.find(event => event.type === 'tool/call' && event.data.name === 'update_goal')
    expect(updateGoalCall).toBeDefined()
    const wrapup = events.find(event =>
      event.type === 'user/message' && eventText(event).includes('<goal_complete>'),
    )
    expect(wrapup).toBeDefined()
    expect(eventSourcePlugin(wrapup!)).toBe('tool-goal')
    // wrapup 在 update_goal 所在 step 的下一个 step（由 step/start 边界推断）
    const stepStartBeforeWrapup = events.filter(event => event.type === 'step/start' && event.seq < wrapup!.seq).at(-1)!
    expect(stepStartBeforeWrapup.data.turn).toBe(updateGoalCall!.data.turn)
    expect(stepStartBeforeWrapup.data.step).toBe((updateGoalCall!.data.step ?? 0) + 1)
    const finalTurnEnd = events.filter(event => event.type === 'turn/end').at(-1)!
    expect(finalTurnEnd.data.reason?.kind).toBe('completed')
    expect(events.some(event => event.type === 'assistant/message' && event.seq > wrapup!.seq)).toBe(true)
    const finalStoppings = stoppings.filter(entry => entry.turn === finalTurnEnd.data.turn)
    expect(finalStoppings.length).toBe(1)
    expect(finalStoppings[0]!.sawWrapup).toBe(true)
    await disposeCtx(ctx)
  })

  it('D-12 oscillation injection: transition budget holds the line', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await plug(ctx, GungnirLoop, { agents: [] })
    const transitions: Array<{ from: string | null; to: string; turn: number }> = []
    // 对抗信号源：每步翻转 EXECUTE/VERIFY 依据（高频振荡注入）
    let flip = false
    provide(ctx, 'gungnirAdaptive', {
      routerInputs(): LoopRouterInputs {
        // 奇数次: claim+outstanding → VERIFY；偶数次: claim=false → EXECUTE（每步翻转）
        flip = !flip
        return {
          hasActiveSpec: true,
          hasCommittedAction: true,
          claimRecordedThisRound: flip,
          machineVerifiableOutstanding: flip,
        }
      },
      currentLoopMode: () => null,
    })
    onAny(ctx, 'gungnir-loop/transition', (raw) => {
      const payload = raw as { from: string | null; to: string; turn: number }
      transitions.push({ from: payload.from, to: payload.to, turn: payload.turn })
    })
    ctx.tools.register(defineTool({
      name: 'probe_noop',
      description: 'no-op probe tool',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'ok' }] },
      execute: async () => ({ ok: true }),
    }))
    let noopCalls = 0
    const adapter = new ScriptedAdapter(() => {
      noopCalls++
      if (noopCalls <= 9) return toolCallResponse(`call-noop-${noopCalls}`, 'probe_noop', {})
      return textResponse('done with the oscillation probe')
    })
    ctx.llm.registerAdapter(['scripted'], adapter)
    const { agent } = await ctx.agents.create({
      sessionId: `probe-osc-${Date.now()}` as never,
      agentOptions: { provider: 'scripted', model: 'probe-model' },
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'probe: oscillation' }],
      source: { kind: 'user' },
    }))
    await waitFor(() => agent.session.events.some(event => event.type === 'turn/end'), 15_000, 'turn end')
    // 振荡确实发生了（≥3 次真实切换），但单 turn 不超预算（初始选定不计预算）
    expect(transitions.length).toBeGreaterThanOrEqual(3)
    // turn 内事件数上限 = 预算 + 初始选定（from=null 不占预算）
    const transitionsInTurn1 = transitions.filter(entry => entry.turn === transitions[0]!.turn)
    expect(transitionsInTurn1.length).toBeLessThanOrEqual(MAX_MODE_TRANSITIONS_PER_TURN + 1)
    expect(transitions.filter(entry => entry.from !== null).length).toBeGreaterThanOrEqual(3)
    await disposeCtx(ctx)
  })

  it('D-13 resume: driver continues a persisted session; loop trajectory extends without a duplicate initial selection', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const root = mkdtempSync(join(tmpdir(), 'gungnir-probe-resume-'))
    await plug(ctx, sessionPersistenceJsonl.default, { root })
    await plug(ctx, GungnirLoop, { agents: [] })
    const wiring = await wireLedger(ctx)
    let callIndex = 0
    ctx.llm.registerAdapter(['scripted'], new ScriptedAdapter(() => {
      callIndex++
      return textResponse(`ack ${callIndex}`)
    }))

    const sessionId = `probe-resume-${Date.now()}`
    const first = await ctx.agents.create({
      sessionId: sessionId as never,
      agentOptions: { provider: 'scripted', model: 'probe-model' },
    })
    first.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'first turn before resume' }],
      source: { kind: 'user' },
    }))
    await waitFor(() => first.agent.session.events.some(event => event.type === 'turn/end'), 15_000, 'first turn end')
    await ctx.sessions.flush(first.agent.session)
    await first.dispose()

    const second = await ctx.agents.resume({
      resumeSessionId: sessionId as never,
      agentOptions: { provider: 'scripted', model: 'probe-model' },
    })
    second.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'second turn after resume' }],
      source: { kind: 'user' },
    }))
    await waitFor(
      () => second.agent.session.events.filter(event => event.type === 'turn/end').length >= 2,
      15_000,
      'resumed turn to complete',
    )
    // 续跑的首个 request/header 带 resume 锚（从 session log 恢复请求基线）
    const headers = second.agent.session.events.filter(event => event.type === 'request/header') as ReadonlyArray<ProbeEvent & { data: { reason?: string } }>
    const resumedHeader = headers.at(-1)
    expect(resumedHeader).toBeDefined()
    expect(resumedHeader!.data.reason).toBe('resume')
    // 轨迹续写：from=null 的初始选定恰好一次；两个 turn 各留一个 loop-state 锚点
    const all = await wiring.kv.loadAll()
    const records = parseLedgerRecords(all.tables['events'] ?? {}, 'probe')
    const state = foldEvents(records.map(record => record.event))
    expect(state.loopTransitions.filter(entry => entry.fromMode === null)).toHaveLength(1)
    expect(state.loopMode).toBe('FAST')
    const anchors = records.filter(record => record.event.type === 'gungnir/loop-state').map(record => record.event as { turn: number })
    expect(anchors.some(anchor => anchor.turn === 1)).toBe(true)
    expect(anchors.some(anchor => anchor.turn === 2)).toBe(true)
    const finalTurnEnd = second.agent.session.events.filter(event => event.type === 'turn/end').at(-1)!
    expect(finalTurnEnd.data.reason?.kind).toBe('completed')
    await disposeCtx(ctx)
  })
})
