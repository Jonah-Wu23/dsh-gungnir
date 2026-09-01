import {
  assertNoL4,
  parseGoalSpec,
  reconcile,
  decisionToPhase,
  satisfiedIdsOf,
  type ProjectionStep,
  type VerdictEvent,
  type Verifier,
  type VerifyContext,
} from 'gungnir-core'
import type { AgentLedger } from './ledger.ts'
import { evidenceFromToolResult, type NewEvidenceInput, type ToolResultView } from './evidence.ts'

/**
 * Reconcile 闭环引擎（一阶段）：
 * - 证据捕获：EXECUTING 轮内的 tools/result → gungnir/evidence；
 * - 轮末：对当前 commit 的 targets 跑 verifier → gungnir/verdict → reconcile 决策 →
 *   gungnir/status；ADVANCE/RETRY 由引擎直接 commit（机械动作），REPLAN 交给模型
 *   下一轮 gungnir_plan 重投影；REVALIDATE 内联全量重验 → COMPLETE 或回 EXECUTING；
 * - COMPLETE/BLOCKED/NEEDS_HUMAN 时通过 hook 注入“请走 update_goal 合法路径”的指令
 *   （authority 合规：Gungnir 不代写 native goal）。
 */

export interface EngineHooks {
  /** 注入模型可见指令（下一 step 领取，不唤醒 driver） */
  injectDirective(agentId: string, text: string): void
  /** 结构化日志（不吞错） */
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void
}

export interface LedgerDirectory {
  get(agentId: string): AgentLedger | undefined
}

function newEvidenceId(prefix: string, unique: string): string {
  return `${prefix}:${unique}`.replace(/\s+/g, '_')
}

export class ReconcileEngine {
  /** 本轮已有 claim / 证据才允许轮末验证（防止对未执行的动作误判）；已验证过的轮不重复结算 */
  private readonly roundsWithClaim = new Set<number>()
  private readonly roundsWithEvidence = new Set<number>()
  private readonly roundsVerified = new Set<number>()

  constructor(
    private readonly ledgers: LedgerDirectory,
    private readonly verifyContext: VerifyContext,
    private readonly verifiers: readonly Verifier[],
    private readonly hooks: EngineHooks,
  ) {}

  private verifierFor(kind: 'exit_code' | 'artifact' | 'llm_rubric'): Verifier | null {
    return this.verifiers.find((verifier) => verifier.kind === kind) ?? null
  }

  /** tools/result 观察点：EXECUTING 轮内的一切工具结果都落 evidence。 */
  async captureToolResult(agentId: string, view: ToolResultView): Promise<void> {
    const ledger = this.ledgers.get(agentId)
    if (ledger === undefined) return
    const state = ledger.current
    if (state.spec === null || state.phase !== 'EXECUTING' || state.currentAction === null) return
    const input = evidenceFromToolResult(
      view,
      state.currentRound,
      state.spec.specId,
      newEvidenceId('ev', `${view.callId}`),
    )
    await this.appendEvidence(ledger, input)
    this.roundsWithEvidence.add(state.currentRound)
  }

  private async appendEvidence(ledger: AgentLedger, input: NewEvidenceInput): Promise<void> {
    const event = { type: 'gungnir/evidence' as const, ...input }
    await ledger.append(event)
  }

  /** gungnir_submit_spec 落地：spec 已通过外部确认后调用。L4 判据禁用（ADR-0017 D1）。 */
  async commitSpec(agentId: string, rawSpec: unknown): Promise<{ specId: string }> {
    const ledger = this.ledgers.get(agentId)
    if (ledger === undefined) throw new Error(`no gungnir ledger for agent ${agentId}`)
    const spec = parseGoalSpec(rawSpec)
    assertNoL4(spec)
    await ledger.append({ type: 'gungnir/spec', spec })
    return { specId: spec.specId }
  }

  /** gungnir_plan 落地：append 投影并 commit 第一个含未满足 target 的 step。 */
  async commitPlan(agentId: string, steps: ReadonlyArray<{ id: string; summary: string; targetsCriteria: string[]; expectedEvidence?: string[] }>, rationale: string): Promise<{ committed: string | null }> {
    const ledger = this.ledgers.get(agentId)
    if (ledger === undefined) throw new Error(`no gungnir ledger for agent ${agentId}`)
    const state = ledger.current
    if (state.spec === null) throw new Error('no active spec; submit a spec first')
    // 一轮一 action：上一轮还没验证完，不允许新投影/新提交（防模型在轮中途重规划）
    if (state.currentAction !== null && state.verdictsInCurrentRound === 0) {
      throw new Error(
        `round ${state.currentRound} already has committed action "${state.currentAction.actionId}" awaiting verification; execute it and call gungnir_report instead of re-planning`,
      )
    }
    const specId = state.spec.specId
    // API 边界预校验：给出模型可自我纠正的错误（合法 id 列表），坏输入不落账
    const validIds = new Set(Object.keys(state.criteria))
    const seenStepIds = new Set<string>()
    for (const step of steps) {
      if (seenStepIds.has(step.id)) throw new Error(`duplicate step id "${step.id}" in projection`)
      seenStepIds.add(step.id)
      const unknown = step.targetsCriteria.filter((id) => !validIds.has(id))
      if (unknown.length > 0) {
        throw new Error(`projection step "${step.id}" targets unknown criteria [${unknown.join(', ')}]; valid criterion ids: ${[...validIds].join(', ')}`)
      }
    }
    const projectionSteps: ProjectionStep[] = steps.map((step) => ({
      id: step.id,
      summary: step.summary,
      targetsCriteria: step.targetsCriteria,
      expectedEvidence: step.expectedEvidence ?? [],
    }))
    const projectionId = `proj-r${state.currentRound + 1}-${ledger.size}`
    await ledger.append({
      type: 'gungnir/plan-projection',
      specId,
      projectionId,
      steps: projectionSteps,
      rationale,
    })
    const pending = projectionSteps.find((step) => step.targetsCriteria.some((id) => state.criteria[id]?.satisfied !== true))
      ?? projectionSteps[0]
    if (pending === undefined) return { committed: null }
    await ledger.append({
      type: 'gungnir/commit',
      specId,
      round: state.currentRound + 1,
      actionId: pending.id,
      summary: pending.summary,
      targetsCriteria: pending.targetsCriteria,
      expectedEvidence: pending.expectedEvidence,
      projectionId,
      stepId: pending.id,
    })
    return { committed: pending.id }
  }

  /** gungnir_report：模型 claim，落账不裁决；报告即触发轮末验证（存储仍存活的时机）。 */
  async recordClaim(agentId: string, claim: { summary: string; assertedOutcome: 'done' | 'partial' | 'failed' | 'blocked'; evidenceRefs?: string[] }): Promise<void> {
    const ledger = this.ledgers.get(agentId)
    if (ledger === undefined) throw new Error(`no gungnir ledger for agent ${agentId}`)
    const state = ledger.current
    if (state.spec === null || state.currentAction === null) throw new Error('no committed action to report against')
    await ledger.append({
      type: 'gungnir/claim',
      specId: state.spec.specId,
      round: state.currentRound,
      actionId: state.currentAction.actionId,
      summary: claim.summary,
      assertedOutcome: claim.assertedOutcome,
      evidenceRefs: claim.evidenceRefs ?? [],
    })
    this.roundsWithClaim.add(state.currentRound)
    // 报告即轮末：headless 收尾会关闭 storage，turn-stopping 兜底时机已不可靠
    await this.runRoundEnd(agentId)
  }

  /** 轮末处理：turn-stopping 时调用。幂等性由 phase 门卫保证（非 EXECUTING/REVALIDATING 直接返回）。 */
  async runRoundEnd(agentId: string): Promise<void> {
    const ledger = this.ledgers.get(agentId)
    if (ledger === undefined) return
    let state = ledger.current
    if (state.spec === null) return
    this.hooks.log('info', `round-end entered: phase=${state.phase} round=${state.currentRound} claims=${[...this.roundsWithClaim]} evidence=${[...this.roundsWithEvidence]}`)
    if (state.phase === 'REVALIDATING') {
      await this.finishRevalidation(agentId, ledger)
      return
    }
    if (state.phase !== 'EXECUTING' || state.currentAction === null) return

    // 防误触发（必须在任何落账之前）：本轮必须有过 claim 或证据采集才结算；
    // 已结算过的轮不重复进入 VERIFYING（ADVANCE 后的 turn-stopping 空轮在此被挡下）
    const pendingAction = state.currentAction
    if (this.roundsVerified.has(pendingAction.round)) return
    if (!this.roundsWithClaim.has(pendingAction.round) && !this.roundsWithEvidence.has(pendingAction.round)) return

    const specId = state.spec.specId
    const round = state.currentRound
    const budget = state.spec.budget

    await ledger.append({
      type: 'gungnir/status',
      specId,
      phase: 'VERIFYING',
      satisfiedCriteria: satisfiedIdsOf(state),
      progressSnapshot: {
        satisfied: satisfiedIdsOf(state).length,
        total: state.spec.successCriteria.length,
        verifiedArtifacts: state.verifiedArtifacts,
        roundsNoImprovement: state.roundsNoImprovement,
      },
    })
    state = ledger.current
    const action = state.currentAction
    if (action === null) return

    const roundVerdicts: VerdictEvent[] = []
    const targets = action.targetsCriteria
    for (const criterionId of targets) {
      const criterionState = state.criteria[criterionId]
      if (criterionState === undefined) continue
      const kind = criterionState.criterion.predicate.kind
      if (kind === 'human') continue // 无机器 verifier，由 reconcile 裁 NEEDS_HUMAN
      if (budget.maxVerifierRuns !== null && state.verdictRuns >= budget.maxVerifierRuns) break
      const verifier = this.verifierFor(kind)
      if (verifier === null) {
        this.hooks.log('warn', `no verifier wired for kind ${kind}; criterion ${criterionId} left unjudged this round`)
        continue
      }
      const result = await verifier.verify(criterionState.criterion, this.verifyContext)
      if (result.evidence !== null) {
        await this.appendEvidence(ledger, {
          specId,
          round,
          evidenceId: newEvidenceId(`ev-${kind}`, `${criterionId}-r${round}-${ledger.size}`),
          source: result.evidence.source,
          ref: result.evidence.ref,
          digest: result.evidence.digest,
          preview: result.evidence.preview,
        })
      }
      const verdict = {
        type: 'gungnir/verdict' as const,
        specId,
        criterionId,
        round,
        verifier: { level: verifier.level as 1 | 2 | 4, kind: verifier.kind },
        outcome: result.outcome,
        errorSignature: result.errorSignature,
        detailRef: result.detailRef,
      }
      await ledger.append(verdict)
      roundVerdicts.push(verdict as VerdictEvent)
    }
    this.roundsVerified.add(round)

    state = ledger.current
    await this.decideAndRecord(agentId, ledger, roundVerdicts, { revalidating: false })
  }

  /** REVALIDATE 决策后内联全量重验（防假验收：所有 criteria 重跑）。 */
  private async finishRevalidation(agentId: string, ledger: AgentLedger): Promise<void> {
    const state = ledger.current
    if (state.spec === null) return
    const specId = state.spec.specId
    const round = Math.max(state.currentRound, 1)
    const budget = state.spec.budget
    const roundVerdicts: VerdictEvent[] = []
    for (const criterion of state.spec.successCriteria) {
      if (criterion.predicate.kind === 'human') continue
      if (budget.maxVerifierRuns !== null && state.verdictRuns >= budget.maxVerifierRuns) break
      const verifier = this.verifierFor(criterion.predicate.kind)
      if (verifier === null) continue
      const result = await verifier.verify(criterion, this.verifyContext)
      if (result.evidence !== null) {
        await this.appendEvidence(ledger, {
          specId,
          round,
          evidenceId: newEvidenceId(`ev-reval`, `${criterion.id}-r${round}-${ledger.size}`),
          source: result.evidence.source,
          ref: result.evidence.ref,
          digest: result.evidence.digest,
          preview: result.evidence.preview,
        })
      }
      const verdict = {
        type: 'gungnir/verdict' as const,
        specId,
        criterionId: criterion.id,
        round,
        verifier: { level: verifier.level as 1 | 2 | 4, kind: verifier.kind },
        outcome: result.outcome,
        errorSignature: result.errorSignature,
        detailRef: result.detailRef,
      }
      await ledger.append(verdict)
      roundVerdicts.push(verdict as VerdictEvent)
    }
    await this.decideAndRecord(agentId, ledger, roundVerdicts, { revalidating: true })
  }

  /** 决策落账 + 终态指令注入 + ADVANCE/RETRY 机械 commit。 */
  private async decideAndRecord(
    agentId: string,
    ledger: AgentLedger,
    roundVerdicts: readonly VerdictEvent[],
    context: { revalidating: boolean },
  ): Promise<void> {
    let state = ledger.current
    const specId = state.spec!.specId
    const decision = reconcile(state, roundVerdicts)
    const effectiveSatisfied = satisfiedIdsOf(state)
    // 快照一致性：roundsNoImprovement 的推进规则与 fold 相同（离开 VERIFYING 时结算）
    const leavingRoundEnd = state.phase === 'VERIFYING'
    const nextRni = leavingRoundEnd
      ? (effectiveSatisfied.length > state.maxSatisfiedSeen ? 0 : state.roundsNoImprovement + 1)
      : state.roundsNoImprovement
    const phase = decisionToPhase(decision.kind)
    await ledger.append({
      type: 'gungnir/status',
      specId,
      phase,
      satisfiedCriteria: effectiveSatisfied,
      progressSnapshot: {
        satisfied: effectiveSatisfied.length,
        total: state.spec!.successCriteria.length,
        verifiedArtifacts: state.verifiedArtifacts,
        roundsNoImprovement: nextRni,
      },
      blocker: decision.kind === 'BLOCKED' ? decision.blocker ?? 'blocked' : '',
      decision: decision.kind,
    })

    state = ledger.current
    switch (decision.kind) {
      case 'REVALIDATE': {
        await this.finishRevalidation(agentId, ledger)
        return
      }
      case 'ADVANCE': {
        if (decision.nextStep !== null && state.spec !== null) {
          await ledger.append({
            type: 'gungnir/commit',
            specId,
            round: state.currentRound + 1,
            actionId: decision.nextStep.id,
            summary: decision.nextStep.summary,
            targetsCriteria: decision.nextStep.targetsCriteria,
            expectedEvidence: decision.nextStep.expectedEvidence,
            projectionId: state.projection?.projectionId ?? null,
            stepId: decision.nextStep.id,
          })
        }
        return
      }
      case 'RETRY': {
        const action = state.currentAction
        if (action !== null && state.spec !== null) {
          await ledger.append({
            type: 'gungnir/commit',
            specId,
            round: state.currentRound + 1,
            actionId: action.actionId,
            summary: action.summary,
            targetsCriteria: [...action.targetsCriteria],
            expectedEvidence: [...action.expectedEvidence],
            projectionId: action.projectionId,
            stepId: action.stepId,
          })
        }
        return
      }
      case 'REPLAN': {
        this.hooks.injectDirective(
          agentId,
          context.revalidating
            ? 'Gungnir: re-validation found a regression. Call gungnir_plan with a fresh projection addressing the regressed criteria; do not redo criteria that already PASS.'
            : 'Gungnir: the current projection premise failed. Call gungnir_plan with a corrected projection (rationale required); do not redo criteria that already PASS.',
        )
        return
      }
      case 'COMPLETE': {
        this.hooks.injectDirective(
          agentId,
          'Gungnir: every success criterion re-verified PASS with deterministic evidence. Call update_goal(action="complete") now — claims are already backed by the ledger.',
        )
        return
      }
      case 'BLOCKED': {
        this.hooks.injectDirective(
          agentId,
          `Gungnir: the loop is blocked (code: ${decision.blocker ?? 'blocked'}). Call update_goal(action="blocked", reason) with this blocker code — do not keep retrying.`,
        )
        return
      }
      case 'NEEDS_HUMAN': {
        this.hooks.injectDirective(
          agentId,
          `Gungnir: human input is required (${decision.rationale}). Surface the question to the user, then call update_goal(action="blocked") with a NEEDS_HUMAN blocker if they cannot answer now.`,
        )
        return
      }
    }
  }
}
