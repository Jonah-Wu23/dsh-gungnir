/**
 * M-A harness 侧探针构造（三阶段 P2，BPAR v0 VERIFY 升级；P2-0③）。
 *
 * 泄题纪律（严格）：探针**不落隐藏输入到磁盘**——脚本是通用驱动，运行场景经 stdin
 * 注入（ShellExecRequest.stdin 通道，插件进程内生成、进程间传递，模型不可见）。
 * 探针文件本体只含：workspace 模块的 file:// URL（模型已知自己的 workspace）与
 * 公开 API 调用序列（README 已文档化），不含任何对抗场景数值。
 *
 * 与离线法官（tools/ve-supply/medicines.mjs）的 M-A probe 同源同构：隐藏输入生成
 * 确定性（同 seed/同对抗结构），检查函数在插件进程内（core 纯函数）调用。
 */

import { generateLedgerReentryScenario } from './ve.ts'

export type ProbeTemplate = 'ledger-reentry' | 'effectively-once'

export interface ProbeOptions {
  /** workspace 模块的 file:// URL（经 api.module 解析；由插件用 pathToFileURL 构造） */
  moduleFileUrl: string
}

export interface ProbeSpec {
  readonly script: string
  /** 探针期望的 stdin 场景 JSON 形状（审计用） */
  readonly stdinShape: string
  /** 探针期望输出的 JSON 形状（审计用） */
  readonly outputShape: string
}

/** 运行场景（隐藏输入）生成：确定性、可复现；由插件进程内生成并经 stdin 注入探针。 */
export function generateProbeScenario(template: ProbeTemplate): Record<string, unknown> {
  if (template === 'ledger-reentry') {
    const scenario = generateLedgerReentryScenario()
    return {
      fund: scenario.fund,
      transfers: scenario.transfers,
      rebatePercent: scenario.rebatePercent,
      accounts: scenario.accounts,
      initial: scenario.fund.reduce((sum, f) => sum + f.amountCents, 0),
    }
  }
  return {
    messages: [{ id: 'm1', key: 'K', payload: 1 }, { id: 'm2', key: 'K', payload: 2 }],
    windowMs: 500,
    processFailures: 1,
    maxAttempts: 3,
    runAt: [1, 200],
    expectedPerKeyOrder: { K: ['m1', 'm2'] },
  }
}

/** 构造探针脚本（纯函数；通用驱动，场景经 stdin 注入——磁盘零隐藏输入）。 */
export function buildProbeScript(template: ProbeTemplate, options: ProbeOptions): ProbeSpec {
  if (template === 'ledger-reentry') return ledgerReentryProbe(options)
  return effectivelyOnceProbe(options)
}

/**
 * ledger-reentry 通用驱动：stdin 收场景 {fund, transfers, rebatePercent, accounts, initial}，
 * 输出 { balances, events, failures, initial }（检查在插件进程内做）。
 * 调用序列 = 公开 API（README 文档化），不泄露任何场景数值。
 */
function ledgerReentryProbe({ moduleFileUrl }: ProbeOptions): ProbeSpec {
  const script = [
    `import { createLedger, transfer, getBalance, createRebateHook } from ${JSON.stringify(moduleFileUrl)}`,
    `import { readFileSync } from 'node:fs'`,
    `const scenario = JSON.parse(readFileSync(0, 'utf8'))`,
    `const ledger = createLedger()`,
    `const failures = []`,
    `for (const f of scenario.fund) { try { ledger.append({ type: 'credit', account: f.account, amountCents: f.amountCents, ts: 0, id: 'fund-' + f.account }) } catch (error) { failures.push('append threw for ' + f.account + ': ' + (error?.message ?? error)) } }`,
    `const hook = createRebateHook(ledger, scenario.rebatePercent)`,
    `for (const t of scenario.transfers) {`,
    `  try { transfer(ledger, t.from, t.to, t.amountCents, { onSettled: hook, clock: () => 1 }) } catch (error) { failures.push('transfer threw: ' + (error?.message ?? error)) }`,
    `}`,
    `const balances = {}`,
    `for (const account of scenario.accounts) { try { balances[account] = getBalance(ledger, account) } catch (error) { failures.push('getBalance threw for ' + account + ': ' + (error?.message ?? error)) } }`,
    `const events = ledger.events().map((e) => ({ type: e.type, account: e.account, amountCents: e.amountCents }))`,
    `console.log(JSON.stringify({ balances, events, failures, initial: scenario.initial }))`,
    `process.exit(0)`,
  ].join('\n')
  return {
    script,
    stdinShape: '{ fund: {account,amountCents}[], transfers: {from,to,amountCents}[], rebatePercent: number, accounts: string[], initial: number }',
    outputShape: '{ balances: Record<string,number>, events: {type,account,amountCents}[], failures: string[], initial: number }',
  }
}

/**
 * effectively-once 通用驱动：stdin 收场景 {messages, windowMs, processFailures, maxAttempts,
 * runAt, expectedPerKeyOrder}，输出 { delivered, failures }。
 */
function effectivelyOnceProbe({ moduleFileUrl }: ProbeOptions): ProbeSpec {
  const script = [
    `import { createQueue, createDedup, createPump, createSink } from ${JSON.stringify(moduleFileUrl)}`,
    `import { readFileSync } from 'node:fs'`,
    `const scenario = JSON.parse(readFileSync(0, 'utf8'))`,
    `const queue = createQueue()`,
    `const sink = createSink()`,
    `let now = 0`,
    `const clock = { now: () => now }`,
    `for (const m of scenario.messages) queue.enqueue(m)`,
    `let failures = 0`,
    `const pump = createPump({ queue, dedup: createDedup({ windowMs: scenario.windowMs }), sink, clock, processMessage: () => (failures++ < scenario.processFailures ? false : true), maxAttempts: scenario.maxAttempts })`,
    `try { for (const t of scenario.runAt) { now = t; pump.run(100) } } catch (error) { console.log(JSON.stringify({ delivered: [], failures: ['pump.run threw: ' + (error?.message ?? error)] })); process.exit(0) }`,
    `const delivered = sink.deliveredIds().map((id) => ({ id, key: 'K' }))`,
    `console.log(JSON.stringify({ delivered, failures: [] }))`,
    `process.exit(0)`,
  ].join('\n')
  return {
    script,
    stdinShape: '{ messages: {id,key,payload}[], windowMs: number, processFailures: number, maxAttempts: number, runAt: number[], expectedPerKeyOrder: Record<string,string[]> }',
    outputShape: '{ delivered: {id,key}[], failures: string[] }',
  }
}
