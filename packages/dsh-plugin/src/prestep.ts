import { satisfiedIdsOf, type GungnirState } from '@gungnir/core'

/**
 * pre-step 指令注入（ADR-0007）：goal round 的第一个 step 之前，把“本轮唯一任务 +
 * criteria 状态 + 证据提示 + claim≠evidence 纪律”追加到消息尾部。
 * 硬约束：绝不替换/丢弃既有消息（goal 源消息被驱动按 id 追踪，丢弃会被 stale 检查拒绝）。
 */

export function buildDirective(state: GungnirState): string | null {
  if (state.spec === null || state.phase === null) return null
  if (state.phase !== 'SPEC_COMMITTED' && state.phase !== 'EXECUTING') return null

  const lines: string[] = []
  const satisfied = satisfiedIdsOf(state)
  const total = state.spec.successCriteria.length

  if (state.currentAction === null) {
    lines.push(
      `[Gungnir round ${state.currentRound + 1} start] No action is committed yet. Call the gungnir_plan tool ONCE with a rolling-horizon projection (ordered steps, each targeting concrete successCriteria). The harness will commit the first actionable step for this round.`,
    )
  } else {
    lines.push(
      `[Gungnir round ${state.currentRound} — committed action ${state.currentAction.actionId}] This round has exactly ONE committed action: ${state.currentAction.summary} (targets: ${state.currentAction.targetsCriteria.join(', ')}). Execute it; do not work on other steps.`,
    )
  }

  lines.push(`Success criteria: ${satisfied.length}/${total} verified PASS (${satisfied.join(', ') || 'none yet'}). Never redo an already-PASS criterion.`)
  lines.push(
    'Discipline: your reports are CLAIMS, not evidence — the harness verifies through gungnir/evidence and issues verdicts. When the action is done, call gungnir_report(summary, asserted_outcome) with an honest outcome.',
  )
  lines.push(
    'Termination: when ALL criteria are verified (the harness will tell you), call update_goal(action="complete"). If genuinely stuck, call update_goal(action="blocked"). Never claim completion without verification.',
  )
  return lines.join('\n')
}

/**
 * VERIFY 模式指令（router 规则 verify-machine-verifiable）：action 已被 claim 且
 * 目标里还有未满足的 L1/L2 谓词——deterministic check 先行，证明的优先序不能反。
 */
export function buildVerifyDirective(state: GungnirState): string | null {
  if (state.spec === null || state.currentAction === null) return null
  const outstanding: string[] = []
  for (const criterionId of state.currentAction.targetsCriteria) {
    const criterionState = state.criteria[criterionId]
    if (criterionState === undefined) continue
    if (!criterionState.satisfied && criterionState.criterion.verifierLevel <= 2) {
      outstanding.push(`${criterionId} (${criterionState.criterion.predicate.kind}/L${criterionState.criterion.verifierLevel})`)
    }
  }
  if (outstanding.length === 0) return null
  return [
    `[Gungnir VERIFY] Machine-verifiable checks are outstanding for action ${state.currentAction.actionId}: ${outstanding.join(', ')}.`,
    'Verification before conclusion: run each exit_code predicate command yourself and re-check each artifact predicate (path/content) with your tools NOW; do not end this turn with unverified claims.',
    'The harness verifier re-checks every criterion from evidence at round end — a claim without deterministic backing will FAIL. If a check cannot pass, say so in gungnir_report with asserted_outcome=failed or blocked instead of claiming done.',
  ].join('\n')
}

export function directiveApplicable(state: GungnirState, step: number): boolean {
  // 实测（0.1.1-rc.2，headless）：step 从 1 起，且单 turn 内可能完成全部工作——
  // 在 SPEC_COMMITTED/EXECUTING 期间逐 step 注入（协议压力），COMPLETE 等终态自然停止。
  return step >= 1 && buildDirective(state) !== null
}
