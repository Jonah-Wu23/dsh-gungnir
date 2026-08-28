/**
 * D-1 kill 子进程（纯 JS，Node 直跑）：模拟“goal round 执行中进程被杀”。
 * 落盘 spec → projection → commit r1 → evidence（全部已提交事件），
 * 在 verdict 产生前 SIGKILL 自杀；父进程从同一 KV 文件重建并断言。
 * 用法：node kill-child.mjs <kvFile> <agentId>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { AgentLedger } from 'dsh-gungnir/ledger.js'

const kvFile = process.argv[2]
const agentId = process.argv[3]
if (kvFile === undefined || agentId === undefined) {
  console.error('usage: node kill-child.mjs <kvFile> <agentId>')
  process.exit(2)
}

/** 与 tools/destruction/src/file-kv.ts 同语义的最小文件 KV（跨进程共享 JSON）。 */
function openKv(path) {
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ tables: { events: {} }, global: null }))
  const read = () => JSON.parse(readFileSync(path, 'utf8'))
  const write = (state) => writeFileSync(path, JSON.stringify(state))
  return {
    async loadAll() {
      const state = read()
      return { tables: { events: { ...(state.tables.events ?? {}) } }, global: state.global }
    },
    async putRecord(table, key, value) {
      const state = read()
      state.tables[table] ??= {}
      state.tables[table][key] = value
      write(state)
    },
    async setGlobal(value) {
      const state = read()
      state.global = value
      write(state)
    },
  }
}

const spec = {
  specId: 'd1-spec',
  version: 1,
  objective: 'kill-mid-round fixture',
  successCriteria: [
    {
      id: 'c1',
      description: 'out/d1.md contains DONE',
      predicate: { kind: 'artifact', path: 'out/d1.md', mustExist: true, contains: 'DONE' },
      verifierLevel: 2,
    },
  ],
  constraints: [],
  nonGoals: [],
  assumptions: [],
  budget: { maxRounds: null, maxVerifierRuns: null },
}

const ledger = await AgentLedger.open(agentId, openKv(kvFile))

await ledger.append({ type: 'gungnir/spec', spec })
await ledger.append({
  type: 'gungnir/plan-projection',
  specId: 'd1-spec',
  projectionId: 'd1-proj',
  steps: [{ id: 's1', summary: 'write out/d1.md', targetsCriteria: ['c1'], expectedEvidence: [] }],
  rationale: 'kill fixture',
})
await ledger.append({
  type: 'gungnir/commit',
  specId: 'd1-spec',
  round: 1,
  actionId: 's1',
  summary: 'write out/d1.md',
  targetsCriteria: ['c1'],
  expectedEvidence: [],
  projectionId: 'd1-proj',
  stepId: 's1',
})
await ledger.append({
  type: 'gungnir/evidence',
  specId: 'd1-spec',
  round: 1,
  evidenceId: 'ev-mid-round',
  source: 'file',
  ref: 'out/d1.md',
  digest: 'a'.repeat(64),
  preview: 'partial work',
})

// 此刻被杀：本轮尚未验证（无 verdict）
process.kill(process.pid, 'SIGKILL')
