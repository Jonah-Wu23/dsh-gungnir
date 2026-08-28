/**
 * architectures.mjs — SwitchBench A/B 两架构的组装与编排（Day 2/3/4 的汇合点）。
 *
 * 方案 A：UnifiedDriver + BranchSearchStrategy（经 strategy host 驱动，一个 driver
 *   实例贯穿调查与执行——Loop ≈ Policy，无交接）。
 * 方案 B：BranchSearchLoop 自持调查 → **人工 SafePoint**（EXPERIMENT.md §2：SafePoint
 *   由实验脚本预先规定"调查完成后切到 ExecutionLoop"，不设自动 router）→
 *   HandoffPacket（8 字段，唯一交接面）→ ExecutionLoop（= UnifiedDriver 基座裸用）
 *   接班执行。
 *
 * 两架构共用：同一冻结 TASK_PROMPT、同一 ModelClient、同一 WorkspaceTools 观察态、
 * 同一 300s deadline、同一收敛规则（branch-protocol）。唯一差异 = Branch Search 住
 * 在哪里 + 收敛后的信息面（A 全量报告入主上下文；B 只有 8 字段包）。
 */
import { UnifiedDriver } from './unified-driver.mjs'
import { WorkspaceTools } from './workspace-tools.mjs'
import { ModelClient } from './model-client.mjs'
import { BranchSearchStrategy, ARCH_A_MAIN_MAX_TURNS } from './branch-search-strategy.mjs'
import { runWithStrategy } from './strategy-host.mjs'
import { BranchSearchLoop } from './branch-search-loop.mjs'
import { PACKET_FIELD_ORDER } from './handoff-packet.mjs'
import { TASK_PROMPT } from '../tasks.mjs'

const EXECUTION_MAX_TURNS = 24

export const ARCHITECTURES = ['a', 'b']

/**
 * 方案 A：调查与执行在同一个 UnifiedDriver 实例内完成。
 * @returns {Promise<{finishReason, finishSummary, architecture: 'a', telemetry}>}
 */
export async function runArchitectureA({ workspace, onEvent, onRequestPayload, deadlineMs, seed }) {
  const model = new ModelClient({ onEvent, onRequestPayload })
  const tools = new WorkspaceTools({ workspace, onEvent })
  const driver = new UnifiedDriver({
    model,
    tools,
    context: [{ role: 'user', content: TASK_PROMPT }],
    onEvent,
    maxTurns: ARCH_A_MAIN_MAX_TURNS,
    deadlineMs,
    label: 'main',
    seed,
  })
  const strategy = new BranchSearchStrategy({ onEvent })
  const result = await runWithStrategy(driver, strategy)
  return { ...result, architecture: 'a', telemetry: { phases: strategy.phases, usage: model.usage } }
}

/**
 * 方案 B：自持 BranchSearchLoop → SafePoint → HandoffPacket → ExecutionLoop 接班。
 * @returns {Promise<{finishReason, finishSummary, architecture: 'b', telemetry, packet}>}
 */
export async function runArchitectureB({ workspace, onEvent, onRequestPayload, deadlineMs, seed }) {
  const model = new ModelClient({ onEvent, onRequestPayload })
  const tools = new WorkspaceTools({ workspace, onEvent })

  const branchLoop = new BranchSearchLoop({ model, tools, onEvent, deadlineMs, seed })
  const { packet, telemetry: branchTelemetry } = await branchLoop.run()

  // ---- SafePoint 人工切换（切点冻结：调查完成后）----
  // ExecutionLoop 是 UnifiedDriver 基座的全新实例；它的唯一输入是冻结 TASK_PROMPT
  // 与 8 字段包。分支阶段的一切内部状态（frontier、分支上下文、报告全文）不越过
  // 这条线——这就是 B 被检验的薄交接主张。
  const executionDriver = new UnifiedDriver({
    model,
    tools,
    context: [
      { role: 'user', content: TASK_PROMPT },
      { role: 'user', content: renderPacketMessage(packet) },
    ],
    onEvent,
    maxTurns: EXECUTION_MAX_TURNS,
    deadlineMs: branchLoop.remainingMs(), // 与调查阶段共享同一个总预算
    label: 'execution',
    seed,
  })
  const result = await executionDriver.run()
  return {
    ...result,
    architecture: 'b',
    packet,
    telemetry: {
      branch: branchTelemetry,
      handoff: { packetBytes: branchTelemetry.packetBytes, packetFields: PACKET_FIELD_ORDER },
      usage: model.usage,
    },
  }
}

/** 交接包在 ExecutionLoop 上下文里的呈现（架构 glue，格式冻结在此）。 */
function renderPacketMessage(packet) {
  return [
    '[handoff packet from the previous controller]',
    JSON.stringify(packet, null, 2),
    'Continue from this handoff packet to achieve the goal stated above.',
  ].join('\n')
}
