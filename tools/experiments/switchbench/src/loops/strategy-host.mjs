/**
 * strategy-host.mjs — 方案 A 专属的 driver 扩展层（[deformation] 计量对象）。
 *
 * EXPERIMENT.md §3：UnifiedDriver 基座是"统一 turn/step/context/tool scheduling/
 * state ownership 契约"的最小宿主。BranchSearchStrategy 要住进这个契约，契约必须
 * 长出以下原语——它们只被 strategy 消费，是"A 的强行适配成本"的实体：
 *
 *   D1. driveTurn 钩子：strategy 接管 turn 循环（基座 run() 只会跑标准 turn）。
 *   D2. sub-conversation 原语：strategy 可以开"私有上下文"的子 driver
 *       （限定工具面、限定轮次、与主上下文隔离，收尾时由 strategy 决定什么进入
 *       主上下文）。基座本身只有单一上下文（物理规律 1）。
 *   D3. 工具面过滤（advertiseTools + allowedTools）：按 phase 限制声明与可用工具。
 *   D4. 共享观察态：子 driver 的工具执行器与主 driver 共享同一份纪律观察与
 *       usage 总账（否则 A 的指标口径碎裂）。
 *
 * B 组不消费本文件——B 的 BranchSearchLoop 自持状态，ExecutionLoop 裸用基座。
 */
import { UnifiedDriver, DRIVER_CAPS } from './unified-driver.mjs'
import { WorkspaceTools } from './workspace-tools.mjs'
import { toolSchemas } from './workspace-tools.mjs'

/**
 * 给基座 driver 挂上 strategy 驱动循环（D1）。
 * @returns {Promise<{finishReason, finishSummary, turns}>} 与基座 run() 同形的收尾
 */
export async function runWithStrategy(driver, strategy) {
  driver.event({ type: 'driver-run-start', label: driver.label, strategy: strategy.name })
  while (!driver.finished) {
    if (driver.turns >= driver.maxTurns) {
      driver.finished = true
      driver.finishReason = 'max-turns'
      driver.event({ type: 'driver-limit', limit: 'max-turns', turns: driver.maxTurns })
      break
    }
    driver.checkDeadline('running the next strategy turn')
    const drove = await strategy.driveTurn(driver)
    if (!drove) break // strategy 显式放弃（如枚举失败且无出路），转失败收尾
  }
  driver.event({ type: 'driver-run-end', label: driver.label, finishReason: driver.finishReason, turns: driver.turns })
  return { finishReason: driver.finishReason, finishSummary: driver.finishSummary, turns: driver.turns }
}

/**
 * 开一个 sub-conversation 子 driver（D2/D3/D4）。
 * @param {object} opts
 * @param {UnifiedDriver} opts.parent 主 driver（共享 model、deadline、事件 sink）
 * @param {import('./workspace-tools.mjs').WorkspaceTools} opts.parentTools 主工具执行器（共享观察态来源）
 * @param {string} opts.label 子会话标识
 * @param {Array<object>} opts.context 子会话初始上下文
 * @param {Set<string>} opts.allowedTools 工具面过滤
 * @param {number} [opts.maxTurns]
 */
export function openSubconversation({ parent, parentTools, label, context, allowedTools, maxTurns }) {
  const tools = new WorkspaceTools({
    workspace: parentTools.workspace,
    onEvent: (event) => parent.event({ ...event, driver: label }),
    allowedTools,
    sharedState: parentTools.sharedState, // D4
  })
  const sub = new UnifiedDriver({
    model: parent.model,
    tools,
    context,
    onEvent: (event) => parent.event(event), // 子事件已带 driver: label 标签，parent.event 保留之
    maxTurns: maxTurns ?? DRIVER_CAPS.maxTurns,
    deadlineMs: parent.remainingMs(),
    label,
    seed: parent.seed,
    advertiseTools: toolSchemas().filter((schema) => allowedTools.has(schema.function.name)), // D3
  })
  return sub
}
