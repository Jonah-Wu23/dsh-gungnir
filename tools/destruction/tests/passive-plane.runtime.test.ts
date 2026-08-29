import { describe, expect, it } from 'vitest'
import { AgentLedger, MemoryKv, parseLedgerRecords } from 'dsh-gungnir/ledger.js'
import { PassivePlaneRuntime } from 'dsh-gungnir/passive-plane.js'
import { tempWorkspace } from './helpers.js'

/**
 * 被动面运行时确定性探针（三阶段 P1 M0）：真实 AgentLedger（MemoryKv 注入）+ 真实
 * PassivePlaneRuntime，脚本化工具观测。覆盖：
 * - S1 不变量观测落账（test-failure / sandbox-denied）；
 * - wrapup 评估触发（update_goal complete 的 tools/result）→ 冲突时 assessment=
 *   intervene + intervention 落账 + MAF 注入；干净完成 → silent；
 * - S2 捕获校验（artifact 缺失）在 wrapup 触发。
 * DSH 钩子（tools/result 事件 → 运行时）由真实 profile 冒烟补验（M0 验收项）。
 */

const AGENT = 'probe-passive-agent'

function runtimeWith(overrides: Partial<ConstructorParameters<typeof PassivePlaneRuntime>[0]> = {}) {
  const injected: string[] = []
  const kv = new MemoryKv()
  let ledger: AgentLedger | null = null
  const workspaceRoot = tempWorkspace()
  const deps = {
    ledgerOf: () => ledger ?? undefined,
    ensureLedger: async (agentId: string) => {
      ledger ??= await AgentLedger.open(agentId, kv)
      return ledger
    },
    injectMessage: (_agentId: string, text: string) => {
      injected.push(text)
    },
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    readFile: async () => null,
    workspaceRoot,
    log: () => undefined,
    ...overrides,
  }
  const runtime = new PassivePlaneRuntime(deps)
  return { runtime, injected, kv, ensureLedger: deps.ensureLedger, workspaceRoot }
}

function resultView(name: string, text: string, extra: Record<string, unknown> = {}) {
  return { name, text, isError: false, callId: `call-${Math.random().toString(36).slice(2, 8)}`, arguments: {}, ...extra }
}

async function ledgerEvents(kv: MemoryKv, agentId: string) {
  const all = await kv.loadAll()
  return parseLedgerRecords(all.tables['events'] ?? {}, agentId).map((record) => record.event)
}

describe('PassivePlaneRuntime（三阶段 P1）', () => {
  it('test-failure 不变量落账 + wrapup 冲突 → assessment=intervene + intervention + MAF 注入', async () => {
    const { runtime, injected, kv, ensureLedger } = runtimeWith()
    await ensureLedger(AGENT)
    await runtime.onToolResult(AGENT, resultView('pwsh', '✖ fmt.test.js (3.8ms)\nℹ fail 1'))
    await runtime.onToolResult(AGENT, resultView('update_goal', '{"ok":true}', { arguments: { goal_id: 'g1', revision: 1, action: 'complete' } }))

    const events = await ledgerEvents(kv, AGENT)
    expect(events.filter((e) => e.type === 'gungnir/invariant').map((e) => e.invariantId)).toContain('test-failure')
    const assessment = events.find((e) => e.type === 'gungnir/assessment')
    expect(assessment?.outcome).toBe('intervene')
    const intervention = events.find((e) => e.type === 'gungnir/intervention')
    expect(intervention).toBeDefined()
    expect(injected.length).toBe(1)
    expect(injected[0]!).toContain('[Gungnir] Evidence conflicts')
    expect(injected[0]!.toLowerCase()).not.toContain('criterion')
  })

  it('干净完成（无失败、无越界）→ assessment=silent、零注入', async () => {
    const { runtime, injected, kv, ensureLedger, workspaceRoot } = runtimeWith()
    await ensureLedger(AGENT)
    await runtime.onToolResult(AGENT, resultView('write', 'ok', { arguments: { file_path: `${workspaceRoot}/out/a.txt` } }))
    await runtime.onToolResult(AGENT, resultView('update_goal', '{"ok":true}', { arguments: { action: 'complete' } }))

    const events = await ledgerEvents(kv, AGENT)
    const assessment = events.find((e) => e.type === 'gungnir/assessment')
    expect(assessment?.outcome).toBe('silent')
    expect(events.some((e) => e.type === 'gungnir/intervention')).toBe(false)
    expect(injected).toEqual([])
  })

  it('S2 捕获：artifact 缺失 → wrapup 冲突', async () => {
    const { runtime, injected, kv, ensureLedger } = runtimeWith({ readFile: async () => null })
    await ensureLedger(AGENT)
    await runtime.capture(AGENT, { expectedArtifacts: [{ path: 'out/c.txt', mustExist: true }], verifyCommands: [], constraints: { noModifyFiles: [], noNewDeps: false } })
    await runtime.onToolResult(AGENT, resultView('update_goal', '{"ok":true}', { arguments: { action: 'complete' } }))

    const events = await ledgerEvents(kv, AGENT)
    const assessment = events.find((e) => e.type === 'gungnir/assessment')
    expect(assessment?.outcome).toBe('intervene')
    expect((assessment as { conflicts: { kind: string }[] }).conflicts.map((c) => c.kind)).toContain('artifact-missing')
    expect(injected.length).toBe(1)
  })

  it('write-outside-workspace 不变量（工具 args 越界路径）→ 冲突', async () => {
    const { runtime, injected, kv, ensureLedger } = runtimeWith()
    await ensureLedger(AGENT)
    await runtime.onToolResult(AGENT, resultView('write', 'ok', { arguments: { file_path: 'C:/Windows/tmp.txt' } }))
    await runtime.onToolResult(AGENT, resultView('update_goal', '{"ok":true}', { arguments: { action: 'complete' } }))

    const events = await ledgerEvents(kv, AGENT)
    expect(events.filter((e) => e.type === 'gungnir/invariant').map((e) => e.invariantId)).toContain('write-outside-workspace')
    expect(events.find((e) => e.type === 'gungnir/assessment')?.outcome).toBe('intervene')
    expect(injected.length).toBe(1)
  })
})
