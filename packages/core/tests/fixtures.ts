import {
  sha256Of,
  type ClaimEvent,
  type CommitEvent,
  type EvidenceEvent,
  type GoalSpec,
  type PlanProjectionEvent,
  type SpecEvent,
  type StatusEvent,
  type VerdictEvent,
  type VerdictOutcome,
  type VerifierKind,
  type VerifierLevel,
} from '../src/index.ts'

let clock = 1_700_000_000_000

/** 单调递增时间戳（envelope ts 权威）。 */
export function ts(): number {
  clock += 7
  return clock
}

type CriterionKind = 'exit_code' | 'artifact' | 'llm_rubric' | 'human'

function levelOf(kind: CriterionKind): VerifierLevel {
  switch (kind) {
    case 'exit_code':
      return 1
    case 'artifact':
      return 2
    case 'llm_rubric':
      return 4
    case 'human':
      return 5
  }
}

function predicateOf(kind: CriterionKind, id: string): GoalSpec['successCriteria'][number]['predicate'] {
  switch (kind) {
    case 'exit_code':
      return { kind, command: `pwsh -Command "exit 0" # ${id}`, expectedExitCode: 0, timeoutMs: 60_000 }
    case 'artifact':
      return { kind, path: `out/${id}.md`, mustExist: true, contains: 'done' }
    case 'llm_rubric':
      return { kind, rubric: `rubric for ${id}`, passThreshold: 0.8 }
    case 'human':
      return { kind, question: `${id}?` }
  }
}

export interface CriterionSpec {
  id: string
  kind: CriterionKind
  description?: string
}

export function makeSpec(options?: {
  specId?: string
  criteria?: CriterionSpec[]
  maxRounds?: number | null
  maxVerifierRuns?: number | null
}): GoalSpec {
  const criteria = options?.criteria ?? [
    { id: 'c1', kind: 'exit_code' as const },
    { id: 'c2', kind: 'artifact' as const },
  ]
  return {
    specId: options?.specId ?? 'spec-1',
    version: 1,
    objective: 'make the thing true',
    successCriteria: criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description ?? `${criterion.id} description`,
      predicate: predicateOf(criterion.kind, criterion.id),
      verifierLevel: levelOf(criterion.kind),
    })),
    constraints: [],
    nonGoals: [],
    assumptions: [],
    budget: { maxRounds: options?.maxRounds ?? null, maxVerifierRuns: options?.maxVerifierRuns ?? null },
  }
}

export function specEvent(spec: GoalSpec, time = ts()): SpecEvent {
  return { type: 'gungnir/spec', v: 1, ts: time, spec }
}

export function projectionEvent(options: {
  specId?: string
  projectionId?: string
  steps?: Array<{ id: string; targets: string[] }>
  rationale?: string
  time?: number
}): PlanProjectionEvent {
  return {
    type: 'gungnir/plan-projection',
    v: 1,
    ts: options.time ?? ts(),
    specId: options.specId ?? 'spec-1',
    projectionId: options.projectionId ?? 'proj-1',
    steps:
      options.steps?.map((step) => ({
        id: step.id,
        summary: `step ${step.id}`,
        targetsCriteria: step.targets,
        expectedEvidence: [],
      })) ?? [
        { id: 's1', summary: 'step s1', targetsCriteria: ['c1'], expectedEvidence: [] },
        { id: 's2', summary: 'step s2', targetsCriteria: ['c2'], expectedEvidence: [] },
      ],
    rationale: options.rationale ?? 'initial projection',
  }
}

export function commitEvent(options: {
  specId?: string
  round: number
  actionId?: string
  summary?: string
  targets?: string[]
  projectionId?: string | null
  stepId?: string | null
  time?: number
}): CommitEvent {
  return {
    type: 'gungnir/commit',
    v: 1,
    ts: options.time ?? ts(),
    specId: options.specId ?? 'spec-1',
    round: options.round,
    actionId: options.actionId ?? 'a1',
    summary: options.summary ?? 'do the action',
    targetsCriteria: options.targets ?? ['c1'],
    expectedEvidence: [],
    projectionId: options.projectionId ?? 'proj-1',
    stepId: options.stepId ?? 's1',
  }
}

export function evidenceEvent(options: {
  specId?: string
  round: number
  evidenceId?: string
  source?: 'tool_result' | 'file' | 'exit_code' | 'env'
  ref?: string
  time?: number
}): EvidenceEvent {
  const ref = options.ref ?? `file://out/c${options.round}.md`
  return {
    type: 'gungnir/evidence',
    v: 1,
    ts: options.time ?? ts(),
    specId: options.specId ?? 'spec-1',
    round: options.round,
    evidenceId: options.evidenceId ?? `ev-${options.round}`,
    source: options.source ?? 'file',
    ref,
    digest: sha256Of(ref),
    preview: 'short preview',
  }
}

export function claimEvent(options: {
  specId?: string
  round: number
  actionId?: string
  assertedOutcome?: 'done' | 'partial' | 'failed' | 'blocked'
  evidenceRefs?: string[]
  time?: number
}): ClaimEvent {
  return {
    type: 'gungnir/claim',
    v: 1,
    ts: options.time ?? ts(),
    specId: options.specId ?? 'spec-1',
    round: options.round,
    actionId: options.actionId ?? 'a1',
    summary: 'i think it is done',
    assertedOutcome: options.assertedOutcome ?? 'done',
    evidenceRefs: options.evidenceRefs ?? [],
  }
}

export function verdictEvent(options: {
  specId?: string
  criterionId: string
  round: number
  kind: VerifierKind
  level: VerifierLevel
  outcome: VerdictOutcome
  errorSignature?: string
  detailRef?: string
  time?: number
}): VerdictEvent {
  return {
    type: 'gungnir/verdict',
    v: 1,
    ts: options.time ?? ts(),
    specId: options.specId ?? 'spec-1',
    criterionId: options.criterionId,
    round: options.round,
    verifier: { level: options.level, kind: options.kind },
    outcome: options.outcome,
    errorSignature: options.errorSignature ?? '',
    detailRef: options.detailRef ?? 'evidence://ev-1',
  }
}

export function statusEvent(options: {
  specId?: string
  phase: StatusEvent['phase']
  satisfied?: string[]
  total?: number
  verifiedArtifacts?: number
  roundsNoImprovement?: number
  blocker?: string
  decision?: StatusEvent['decision']
  time?: number
}): StatusEvent {
  const satisfied = options.satisfied ?? []
  const total = options.total ?? 2
  return {
    type: 'gungnir/status',
    v: 1,
    ts: options.time ?? ts(),
    specId: options.specId ?? 'spec-1',
    phase: options.phase,
    satisfiedCriteria: satisfied,
    progressSnapshot: {
      satisfied: satisfied.length,
      total,
      verifiedArtifacts: options.verifiedArtifacts ?? 0,
      roundsNoImprovement: options.roundsNoImprovement ?? 0,
    },
    blocker: options.blocker ?? '',
    decision: options.decision,
  }
}

/**
 * 标准 happy path：两轮提交 + GOAL_REVALIDATION + COMPLETE。
 * c1（L1 exit_code）r1 过，c2（L2 artifact）r2 过，重验全过 → COMPLETE。
 */
export function happyLedger(specId = 'spec-1'): unknown[] {
  const spec = makeSpec({ specId })
  return [
    specEvent(spec),
    projectionEvent({ specId, steps: [{ id: 's1', targets: ['c1'] }, { id: 's2', targets: ['c2'] }] }),
    commitEvent({ specId, round: 1, actionId: 'a1', stepId: 's1', targets: ['c1'] }),
    evidenceEvent({ specId, round: 1, evidenceId: 'ev-1' }),
    claimEvent({ specId, round: 1 }),
    statusEvent({ specId, phase: 'VERIFYING', satisfied: [], total: 2 }),
    verdictEvent({ specId, criterionId: 'c1', round: 1, kind: 'exit_code', level: 1, outcome: 'PASS' }),
    statusEvent({ specId, phase: 'EXECUTING', satisfied: ['c1'], total: 2, decision: 'ADVANCE' }),
    commitEvent({ specId, round: 2, actionId: 'a2', stepId: 's2', targets: ['c2'] }),
    evidenceEvent({ specId, round: 2, evidenceId: 'ev-2' }),
    statusEvent({ specId, phase: 'VERIFYING', satisfied: ['c1'], total: 2 }),
    verdictEvent({ specId, criterionId: 'c2', round: 2, kind: 'artifact', level: 2, outcome: 'PASS' }),
    statusEvent({
      specId,
      phase: 'REVALIDATING',
      satisfied: ['c1', 'c2'],
      total: 2,
      verifiedArtifacts: 1,
      decision: 'REVALIDATE',
    }),
    verdictEvent({ specId, criterionId: 'c1', round: 2, kind: 'exit_code', level: 1, outcome: 'PASS' }),
    verdictEvent({ specId, criterionId: 'c2', round: 2, kind: 'artifact', level: 2, outcome: 'PASS' }),
    statusEvent({
      specId,
      phase: 'COMPLETE',
      satisfied: ['c1', 'c2'],
      total: 2,
      verifiedArtifacts: 1,
      decision: 'COMPLETE',
    }),
  ]
}
