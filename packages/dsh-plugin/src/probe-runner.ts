/**
 * M-A harness 侧探针执行器（三阶段 P2，BPAR v0 VERIFY 升级；P2-0③）。
 *
 * 泄题纪律（严格）：隐藏输入（对抗场景）由插件进程内生成、经 stdin 注入探针进程，
 * **磁盘零落盘**——探针文件本体不含任何场景数值（只含公开 API 调用序列 + workspace
 * 模块 URL）。跑完即删（工作区卫生）；崩溃/输出不可解析 = 失败（fail loud）。
 *
 * 与离线法官（ve-supply medicines.mjs applyMA）同源同构：隐藏输入确定性（同 seed
 * 同题），检查函数（core 纯函数）在插件进程内对探针输出做裁决。
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, rmSync } from 'node:fs'
import {
  buildProbeScript,
  checkEffectivelyOnce,
  checkLedgerReentry,
  checkPerKeyOrder,
  generateProbeScenario,
  type CommandObservation,
  type ProbeTemplate,
} from '@gungnir/core'

export interface ProbeRunnerDeps {
  /** ctx.shell 执行器（与模型同沙箱；命令构造纪律：探针走单进程 node，沙箱兼容） */
  runCommand(command: string, timeoutMs: number, stdin?: string): Promise<CommandObservation>
  workspaceRoot: string
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void
}

export interface ProbeOutcome {
  readonly ok: boolean
  readonly failures: string[]
}

/** 探针执行：场景经 stdin 注入（磁盘零隐藏输入）；输出 JSON 的检查在进程内 core 完成。
 *  探针文件用中性随机名（泄题纪律：文件名不得含 probe/探针语义），跑完即删。 */
export async function runTrunkProbe(deps: ProbeRunnerDeps, template: ProbeTemplate, moduleFileUrl: string, timeoutMs = 120_000): Promise<ProbeOutcome> {
  const { script } = buildProbeScript(template, { moduleFileUrl })
  const scenario = generateProbeScenario(template)
  const probePath = join(tmpdir(), `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.mjs`)
  writeFileSync(probePath, script, 'utf8')
  try {
    let result: CommandObservation
    try {
      result = await deps.runCommand(`node ${JSON.stringify(probePath)}`, timeoutMs, JSON.stringify(scenario))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, failures: [`probe execution blocked by the sandbox: ${message}`] }
    }
    const stdout = `${result.stdout ?? ''}`
    let parsed: { balances?: Record<string, number>; events?: { type: string; account: string; amountCents: number }[]; initial?: number; delivered?: { id: string; key: string }[]; failures?: string[] }
    try {
      parsed = JSON.parse(stdout.split('\n').filter((line) => line.trim() !== '').join('\n'))
    } catch {
      return { ok: false, failures: [`trunk probe output unparsable (exit ${result.exitCode}): ${stdout.slice(0, 300)}`] }
    }
    const probeFailures = Array.isArray(parsed.failures) ? parsed.failures.filter((f): f is string => typeof f === 'string') : []
    const events = (parsed.events ?? []) as { type: 'debit' | 'credit'; account: string; amountCents: number }[]
    const checkFailures = template === 'ledger-reentry'
      ? checkLedgerReentry(events, parsed.balances ?? {}, parsed.initial ?? 0)
      : [...checkEffectivelyOnce(parsed.delivered ?? []), ...checkPerKeyOrder(parsed.delivered ?? [], { K: ['m1', 'm2'] })]
    const failures = [...probeFailures, ...checkFailures]
    if (failures.length === 0 && result.exitCode !== 0) {
      failures.push(`trunk probe exited ${result.exitCode} despite clean checks (expected 0): ${stdout.slice(0, 200)}`)
    }
    return { ok: failures.length === 0, failures }
  } finally {
    rmSync(probePath, { force: true })
  }
}
