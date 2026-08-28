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

export function directiveApplicable(state: GungnirState, step: number): boolean {
  return step === 0 && buildDirective(state) !== null
}
