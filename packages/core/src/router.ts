import type { LoopMode } from './schema/events.ts'
import type { GungnirState } from './schema/state.ts'

/**
 * Loop Strategy router v0（二阶段 M1；确定性规则，公开声明、可审计、可落账）。
 *
 * 铁律边界（Let It Go）：router 只消费 fold 状态派生的结构化事实，
 * 绝不用关键词/正则嗅探任务文本。校准输入（ADR-0013 修订第 6/7 条）：
 * Default-to-cheap, escalate-on-evidence——router 判定不介入时，Gungnir 的
 * 行为必须与普通 DSH 无差别（FAST = 原生路径，不注入任何 Gungnir 负担）。
 */

/** Loop Strategy 词汇表的运行时常量（类型权威在 schema/events.ts）。 */
export const LOOP_MODES: readonly LoopMode[] = ['FAST', 'EXECUTE', 'VERIFY']

/** router 输入：全部由 GungnirState 派生（结构化事实，无语义嗅探）。 */
export interface LoopRouterInputs {
  /** 存在非终态 spec（goal 工作在途） */
  hasActiveSpec: boolean
  /** 存在已 commit 未结算的 action */
  hasCommittedAction: boolean
  /** 当前轮已有 claim（gungnir_report 已落账） */
  claimRecordedThisRound: boolean
  /** 本 action 的目标 criterion 中存在未满足的机器可复验项（L1/L2） */
  machineVerifiableOutstanding: boolean
}

/** router 输出：模式 + 命中的决策规则标识（落账审计字段 rule）。 */
export interface LoopRouteDecision {
  mode: LoopMode
  rule: 'verify-machine-verifiable' | 'execute-action' | 'execute-goal-work' | 'fast-no-goal-work' | 'hysteresis-hold'
}

export function routerInputsOf(state: GungnirState): LoopRouterInputs {
  const terminal = state.phase === null
    || state.phase === 'COMPLETE'
    || state.phase === 'BLOCKED'
    || state.phase === 'NEEDS_HUMAN'
  const hasCommittedAction = state.currentAction !== null
    && (state.phase === 'EXECUTING' || state.phase === 'VERIFYING' || state.phase === 'REVALIDATING')
  const claimRecordedThisRound = state.lastClaim !== null
    && state.currentAction !== null
    && state.lastClaim.round === state.currentAction.round
  let machineVerifiableOutstanding = false
  const action = state.currentAction
  if (action !== null && state.spec !== null) {
    for (const criterionId of action.targetsCriteria) {
      const criterionState = state.criteria[criterionId]
      if (criterionState === undefined) continue
      if (!criterionState.satisfied && criterionState.criterion.verifierLevel <= 2) {
        machineVerifiableOutstanding = true
        break
      }
    }
  }
  return {
    hasActiveSpec: !terminal,
    hasCommittedAction,
    claimRecordedThisRound,
    machineVerifiableOutstanding,
  }
}

/**
 * 决策表（有序，先命中先赢）：
 * 1. VERIFY  —— action 已被 claim 且目标里有未满足的 L1/L2 谓词：验证优先序
 *              不能反（deterministic check 先行），驱动模型先跑机器可复验检查。
 * 2. EXECUTE —— action 已 commit 未 claim：执行轮（原生工具面 + reconcile 指令）。
 * 3. EXECUTE —— 有活跃 spec 无 committed action：规划/续轮工作（reconcile 指令）。
 * 4. FAST    —— 无 goal 工作在途：原生对话路径，零 Gungnir 注入（Default-to-cheap：
 *              不削工具面、不降模型档——v0 的"便宜"指不叠加认知负担；模型轴归三阶段）。
 */
export function routeLoopMode(inputs: LoopRouterInputs): LoopRouteDecision {
  if (inputs.hasCommittedAction && inputs.claimRecordedThisRound && inputs.machineVerifiableOutstanding) {
    return { mode: 'VERIFY', rule: 'verify-machine-verifiable' }
  }
  if (inputs.hasCommittedAction && !inputs.claimRecordedThisRound) {
    return { mode: 'EXECUTE', rule: 'execute-action' }
  }
  if (inputs.hasActiveSpec) {
    return { mode: 'EXECUTE', rule: 'execute-goal-work' }
  }
  return { mode: 'FAST', rule: 'fast-no-goal-work' }
}

// ---- Adaptive Loop 服务契约（driver ↔ gungnir 插件的接缝，双方都依赖 core） ----

/**
 * dsh-gungnir 插件在 ctx 上提供的可选服务名：driver 经 `ctx.get(...)`
 * 读取（cordis 的 get 不受 inject 强制约束，服务缺席时 driver 走原生路径）。
 */
export const GUNGNIR_ADAPTIVE_SERVICE = 'gungnirAdaptive'

/** Prove 层暴露给 Adapt 层的结构化事实（只读派生，无语义嗅探）。 */
export interface GungnirAdaptiveService {
  /** 返回该 agent 的 router 输入（fold 状态派生；ledger 未就位时返回全 false）。 */
  routerInputs(agentId: string): LoopRouterInputs
  /**
   * 返回该 agent 在账本中的当前 Loop Mode（resume 场景：driver 实例是新的，
   * 账本轨迹已在——新实例必须从账本现值起步，绝不能重发 from=null 的初始选定，
   * 否则 strict replay 会拒绝（from 与派生 loopMode 不符）。null = 账本尚无轨迹。
   */
  currentLoopMode?(agentId: string): LoopMode | null
}
