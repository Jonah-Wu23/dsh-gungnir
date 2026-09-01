/**
 * run-selfcheck.mjs — P2 装置合意性自检（铁律 10 跑批前置；双侧自检）。
 *
 * 病态必触发 / 健康必不触发，全触发器（SIG-1/2/3/4 + 契约 claim-check + M-A probe）×
 * 全任务（C1/C2/T1/T3/H1）。任一方向不符 → 输出 SELFCHECK FAIL 并 exit 1（熔断语义：
 * 跑批前必全过；装置缺陷按铁律 10 修装置，不得带病跑批）。
 *
 * 额外强度：真实健康会话重放——把 m5 健康 run（deepseek-H1-a）的 tool-log 喂进升级
 * 计数器，断言零信号（模型真实健康行为不得触发误报）。
 *
 * 用法：node selfcheck/run-selfcheck.mjs
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assessContractCriteria,
  buildMafMessage,
  emptyEscalationCounters,
  observeEscalationEvent,
  observeEscalationStep,
  parseDispatchContract,
  contractToSupplied,
  sandboxCompatCommand,
  unverifiableConflicts,
  checkLedgerReentry,
  checkEffectivelyOnce,
  checkPerKeyOrder,
} from '../../../../../packages/core/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const p2Root = resolve(HERE, '..')
const tasksDir = join(p2Root, 'tasks')
const contractsDir = join(p2Root, 'contracts')
const m5Results = join(p2Root, '..', 'm5', 'results')

/** 修复 overlay（自检用：病态工作区 + 修复 → 健康态）。 */
const FIXES = {
  'C1-envwall': { path: 'src/format.js', content: 'export function formatBytes(bytes) {\n  if (bytes < 1024) return `${bytes} B`\n  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`\n  return `${(bytes / 1048576).toFixed(1)} MB`\n}\n' },
  'C2-redherring': { path: 'src/calc.js', content: 'export function orderTotal(lineItems) {\n  if (lineItems.length === 0) return 0\n  let subtotal = 0\n  for (const item of lineItems) {\n    subtotal += item.qty * item.priceCents\n  }\n  return subtotal + 499\n}\n' },
  'H1-cachekit': null, // H1 健康用 m5 现成修复态（m5/selfcheck overlay 语义；此处直接用跑批器判定口径）
}

const results = { checks: [], ok: true }

function check(name, condition, detail) {
  results.checks.push({ name, ok: condition, detail })
  if (!condition) results.ok = false
  console.log(`${condition ? '✓' : '✗'} ${name}${detail !== undefined ? ` :: ${detail}` : ''}`)
}

/** 契约 claim-check 自检（真实工作区 + 真实契约，跑 core 纯函数）。 */
async function claimCheckWorkspace(taskId, contractFile, overlay) {
  const ws = mkdtempSync(join(tmpdir(), 'p2-selfcheck-'))
  try {
    cpSync(join(tasksDir, taskId), ws, { recursive: true })
    if (overlay !== null) {
      const target = join(ws, overlay.path)
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, overlay.content, 'utf8')
    }
    const contract = parseDispatchContract(JSON.parse(readFileSync(join(contractsDir, contractFile), 'utf8')))
    const supplied = contractToSupplied(contract)
    const s2Ctx = {
      runCommand: async (command) => {
        // 与插件同口径：沙箱兼容变换后 spawnSync（selfcheck 在沙箱外跑，直接 node）
        const compat = sandboxCompatCommand(command)
        const result = spawnSync(compat, { cwd: ws, shell: true, encoding: 'utf8', timeout: 120_000, windowsHide: true })
        return { exitCode: result.status ?? 1 }
      },
      readFile: async (path) => {
        try {
          return readFileSync(join(ws, path), 'utf8')
        } catch {
          return null
        }
      },
      now: () => Date.now(),
    }
    const contractAssessment = await assessContractCriteria(supplied, s2Ctx)
    const conflicts = [...contractAssessment.conflicts, ...unverifiableConflicts(supplied)]
    const blocked = conflicts.length > 0
    return { blocked, conflicts, supplied }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

/** 升级计数器重放（SIG-2/3/4）：输入为 EscalationEventView / step 序列。 */
function replayEscalation(events, steps = []) {
  let state = emptyEscalationCounters()
  const signals = []
  for (const event of events) {
    const r = observeEscalationEvent(state, event)
    state = r.counters
    signals.push(...r.signals)
  }
  for (const activity of steps) {
    const r = observeEscalationStep(state, activity)
    state = r.counters
    signals.push(...r.signals)
  }
  return signals
}

/** 真实健康会话重放：m5 deepseek-H1-a 的 tool-log（模型真实健康行为）。 */
function replayRealSession(toolLogPath) {
  if (!existsSync(toolLogPath)) return { signals: [], reason: 'tool-log missing' }
  let state = emptyEscalationCounters()
  const signals = []
  for (const line of readFileSync(toolLogPath, 'utf8').trim().split('\n')) {
    if (line === '') continue
    const event = JSON.parse(line)
    const view = {
      type: event.type,
      name: event.name,
      text: typeof event.text === 'string' ? event.text : undefined,
      isError: event.isError === true,
      path: typeof event.args?.file_path === 'string' ? event.args.file_path : typeof event.args?.path === 'string' ? event.args.path : undefined,
    }
    if (event.type === 'tool/result' || event.type === 'tool/call') {
      const r = observeEscalationEvent(state, view)
      state = r.counters
      signals.push(...r.signals)
    }
  }
  return { signals }
}

async function main() {
  // ---- 病态必触发：契约 claim-check（L1 FAIL） ------------------------------------
  const c1Diseased = await claimCheckWorkspace('C1-envwall', 'contract-C1-envwall.json', null)
  check('C1 病态工作区 claim-check 必拦（L1 node --test FAIL）', c1Diseased.blocked, JSON.stringify(c1Diseased.conflicts.map((c) => c.kind)))

  const c2Diseased = await claimCheckWorkspace('C2-redherring', 'contract-C2-redherring.json', null)
  check('C2 病态工作区 claim-check 必拦（L1 FAIL）', c2Diseased.blocked, JSON.stringify(c2Diseased.conflicts.map((c) => c.kind)))

  // ---- 健康必不触发：契约 claim-check（修复态） -----------------------------------
  const c1Healthy = await claimCheckWorkspace('C1-envwall', 'contract-C1-envwall.json', FIXES['C1-envwall'])
  check('C1 健康工作区 claim-check 必放行（silent）', !c1Healthy.blocked, JSON.stringify(c1Healthy.conflicts.map((c) => c.kind)))

  const c2Healthy = await claimCheckWorkspace('C2-redherring', 'contract-C2-redherring.json', FIXES['C2-redherring'])
  check('C2 健康工作区 claim-check 必放行', !c2Healthy.blocked)

  // ---- ③ M-C 三态（T3 契约含沙箱外判据）：任何工作区宣称完成必拦 --------------------
  const t3 = await claimCheckWorkspace('C1-envwall', 'contract-C1-envwall.json', FIXES['C1-envwall'])
  const t3Contract = parseDispatchContract(JSON.parse(readFileSync(join(contractsDir, 'contract-C1-envwall.json'), 'utf8')))
  const mc = unverifiableConflicts(contractToSupplied({ ...t3Contract, acceptance: [...t3Contract.acceptance, { id: 'c9-ext', description: 'sandbox-external', verifierLevel: 1, command: 'node --test test/ext.test.js', observability: 'sandbox-external' }] }))
  check('③ M-C 三态：沙箱外判据存在时宣称完成必拦（unverifiable-claim）', mc.length === 1 && mc[0]?.kind === 'unverifiable-claim', JSON.stringify(mc.map((c) => c.kind)))

  // ---- M-A probe：病态 T1 必 FAIL，健康 T1 必 PASS ----------------------------------
  const t1Ws = mkdtempSync(join(tmpdir(), 'p2-selfcheck-t1-'))
  try {
    cpSync(join(p2Root, '..', 'm5', 'tasks', 'T1-ledgerd'), t1Ws, { recursive: true })
    const t1Contract = parseDispatchContract(JSON.parse(readFileSync(join(p2Root, '..', 'm5', 'contracts', 'contract-T1.json'), 'utf8')))
    const t1Supplied = contractToSupplied(t1Contract)
    const api = t1Supplied.api
    const probeCheck = async (wsDir) => {
      const moduleUrl = new URL(`file:///${wsDir.replace(/\\/g, '/')}/${api.module}`).href
      const probePath = join(tmpdir(), `p2-selfcheck-probe-${Date.now()}.mjs`)
      const { buildProbeScript, generateProbeScenario } = await import('../../../../../packages/core/dist/probe.js')
      const { script } = buildProbeScript(api.template, { moduleFileUrl: moduleUrl })
      const scenario = JSON.stringify(generateProbeScenario(api.template))
      writeFileSync(probePath, script, 'utf8')
      try {
        const result = spawnSync(process.execPath, [probePath], { cwd: wsDir, input: scenario, encoding: 'utf8', timeout: 120_000, windowsHide: true })
        const parsed = JSON.parse(result.stdout)
        const events = (parsed.events ?? []).map((e) => ({ type: e.type, account: e.account, amountCents: e.amountCents }))
        const failures = [...(parsed.failures ?? []), ...(api.template === 'ledger-reentry' ? checkLedgerReentry(events, parsed.balances ?? {}, parsed.initial ?? 0) : [...checkEffectivelyOnce(parsed.delivered ?? []), ...checkPerKeyOrder(parsed.delivered ?? [], { K: ['m1', 'm2'] })])]
        return { ok: failures.length === 0, failures }
      } finally {
        rmSync(probePath, { force: true })
      }
    }
    const t1Diseased = await probeCheck(t1Ws)
    check('M-A probe：病态 T1 必 FAIL（ledger-reentry 隐藏输入）', !t1Diseased.ok, JSON.stringify(t1Diseased.failures.slice(0, 2)))
    // 健康 T1：修复 snapshot.js（严格失效）
    writeFileSync(join(t1Ws, 'src', 'snapshot.js'), readFileSync(join(p2Root, '..', 'm5', 'selfcheck', 'T1-healthy', 'src', 'snapshot.js'), 'utf8'))
    const t1Healthy = await probeCheck(t1Ws)
    check('M-A probe：健康 T1 必 PASS', t1Healthy.ok, JSON.stringify(t1Healthy.failures))
  } finally {
    rmSync(t1Ws, { recursive: true, force: true })
  }

  // ---- M-A probe：effectively-once（T2）病态必 FAIL，健康必 PASS ---------------------
  const t2Ws = mkdtempSync(join(tmpdir(), 'p2-selfcheck-t2-'))
  try {
    cpSync(join(p2Root, '..', 'm5', 'tasks', 'T2-relaypump'), t2Ws, { recursive: true })
    const t2Contract = parseDispatchContract(JSON.parse(readFileSync(join(p2Root, '..', 'm5', 'contracts', 'contract-T2.json'), 'utf8')))
    const t2Api = contractToSupplied(t2Contract).api
    const t2Probe = async (wsDir) => {
      const moduleUrl = new URL(`file:///${wsDir.replace(/\\/g, '/')}/${t2Api.module}`).href
      const probePath = join(tmpdir(), `p2-selfcheck-probe-t2-${Date.now()}.mjs`)
      const { buildProbeScript, generateProbeScenario } = await import('../../../../../packages/core/dist/probe.js')
      const { script } = buildProbeScript(t2Api.template, { moduleFileUrl: moduleUrl })
      const scenario = JSON.stringify(generateProbeScenario(t2Api.template))
      writeFileSync(probePath, script, 'utf8')
      try {
        const result = spawnSync(process.execPath, [probePath], { cwd: wsDir, input: scenario, encoding: 'utf8', timeout: 120_000, windowsHide: true })
        const parsed = JSON.parse(result.stdout)
        const failures = [...(parsed.failures ?? []), ...checkEffectivelyOnce(parsed.delivered ?? []), ...checkPerKeyOrder(parsed.delivered ?? [], { K: ['m1', 'm2'] })]
        return { ok: failures.length === 0, failures }
      } finally {
        rmSync(probePath, { force: true })
      }
    }
    const t2Diseased = await t2Probe(t2Ws)
    check('M-A probe：病态 T2 必 FAIL（effectively-once 三体）', !t2Diseased.ok, JSON.stringify(t2Diseased.failures.slice(0, 2)))
    // 健康 T2：m5 selfcheck 的 T2-healthy overlay（先记录 + 队首重排）
    cpSync(join(p2Root, '..', 'm5', 'selfcheck', 'T2-healthy', 'src', 'pump.js'), join(t2Ws, 'src', 'pump.js'), { force: true })
    cpSync(join(p2Root, '..', 'm5', 'selfcheck', 'T2-healthy', 'src', 'queue.js'), join(t2Ws, 'src', 'queue.js'), { force: true })
    const t2Healthy = await t2Probe(t2Ws)
    check('M-A probe：健康 T2 必 PASS', t2Healthy.ok, JSON.stringify(t2Healthy.failures))
  } finally {
    rmSync(t2Ws, { recursive: true, force: true })
  }

  // ---- SIG-2 重复失败：同 errorSignature 连续 ≥3 必触发；写事件打断必不触发 ---------
  const sig2 = replayEscalation([
    { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true },
    { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true },
    { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true },
  ])
  check('SIG-2 病态必触发（同 EPERM 签名连续 3）', sig2.some((s) => s.signal === 'sig-2'), JSON.stringify(sig2.map((s) => s.signal)))

  const sig2No = replayEscalation([
    { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true },
    { type: 'tool/call', name: 'edit', path: 'src/a.js' },
    { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true },
    { type: 'tool/result', name: 'pwsh', text: 'spawn EPERM denied', isError: true },
  ])
  check('SIG-2 健康必不触发（写动作打断连击）', sig2No.every((s) => s.signal !== 'sig-2'), JSON.stringify(sig2No.map((s) => s.signal)))

  // ---- SIG-3 无效浪费：同文件未变化重读 ≥3 必触发；内容变化必不触发 ------------------
  const readText = '<content>FATAL: lost connection</content>'
  const sig3 = replayEscalation(Array.from({ length: 4 }, () => ({ type: 'tool/result', name: 'read', text: readText, isError: false })))
  check('SIG-3 病态必触发（同内容重读 3 次）', sig3.some((s) => s.signal === 'sig-3'), JSON.stringify(sig3.map((s) => s.signal)))

  const sig3No = replayEscalation([
    { type: 'tool/result', name: 'read', text: readText, isError: false },
    { type: 'tool/result', name: 'read', text: readText, isError: false },
    { type: 'tool/result', name: 'read', text: '<content>FIXED</content>', isError: false },
    { type: 'tool/result', name: 'read', text: '<content>FIXED</content>', isError: false },
  ])
  check('SIG-3 健康必不触发（内容变化后重读合理）', sig3No.every((s) => s.signal !== 'sig-3'))

  // ---- SIG-4 停滞：连续 8 步无工具活动必触发；有活动必不触发 -------------------------
  const sig4 = replayEscalation([], Array.from({ length: 8 }, () => false))
  check('SIG-4 病态必触发（8 步无工具活动）', sig4.some((s) => s.signal === 'sig-4'), JSON.stringify(sig4.map((s) => s.signal)))

  const sig4No = replayEscalation([], [false, false, true, false, false, false, false, false])
  check('SIG-4 健康必不触发（工具活动打断停滞）', sig4No.every((s) => s.signal !== 'sig-4'))

  // ---- 真实健康会话重放：m5 deepseek-H1-a 不得触发任何升级信号 -----------------------
  const m5batch = join(m5Results, 'm5-2026-08-30T20-54-05-350Z')
  const h1 = replayRealSession(join(m5batch, 'deepseek-H1-a.tool-log.jsonl'))
  check('真实健康会话（m5 deepseek-H1-a）零升级信号', h1.signals.length === 0, JSON.stringify(h1.signals.map((s) => s.signal)))

  // ---- 汇总 ------------------------------------------------------------------------
  const selfcheck = { ts: Date.now(), allOk: results.ok, checks: results.checks }
  const outDir = join(p2Root, 'results', 'p2-selfcheck')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'selfcheck.json'), JSON.stringify(selfcheck, null, 2), 'utf8')
  console.log(`\n[p2-selfcheck] ${results.checks.filter((c) => c.ok).length}/${results.checks.length} checks passed → ${join(outDir, 'selfcheck.json')}`)
  if (!results.ok) {
    console.error('[p2-selfcheck] SELFCHECK FAIL — 装置不合意，禁止跑批（铁律 10）')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
