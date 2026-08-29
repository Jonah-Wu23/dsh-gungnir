import { z } from 'zod'
import { GoalSpecSchema, type GoalSpec } from './spec.ts'
import { EventEnvelopeFieldsSchema } from './envelope.ts'
import {
  PassiveAssessmentEventSchema,
  PassiveCaptureEventSchema,
  PassiveInterventionEventSchema,
  PassiveInvariantEventSchema,
  type ConflictDetail,
  type S2Capture,
} from './passive.ts'

/**
 * Gungnir ledger 事件 schema v1（M0 冻结）。
 *
 * 载体（ADR-0006）：事件存于 ctx.storage 独立 append-only ledger（不是 session log——
 * DSH persistence 白名单封闭，自定义 durable 事件类型无法通过 resume 校验，见
 * docs/context/dsh-interface.md §4）。本文件只定义事件形状；顺序由 ledger append 序列保证。
 *
 * envelope：{ v: 1, ts, type, ...payload }。ts 为 epoch 毫秒，envelope 是唯一时间权威
 * （一阶段计划表中 payload 内的 ts 收敛进 envelope，避免双时间源）。
 * gungnir/loop-state、gungnir/loop-transition 为 ADR-0005 预留命名空间，
 * 二阶段 M1 起接入（本文件定义事件形状；fold 见 fold.ts）。
 */

export const GungnirEventTypeSchema = z.enum([
  'gungnir/spec',
  'gungnir/plan-projection',
  'gungnir/commit',
  'gungnir/evidence',
  'gungnir/claim',
  'gungnir/verdict',
  'gungnir/status',
  'gungnir/loop-state',
  'gungnir/loop-transition',
  'gungnir/invariant',
  'gungnir/capture',
  'gungnir/assessment',
  'gungnir/intervention',
])
export type GungnirEventType = z.infer<typeof GungnirEventTypeSchema>

// ---- gungnir/spec -------------------------------------------------------------

export const SpecEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/spec'),
  spec: GoalSpecSchema,
})

// ---- gungnir/plan-projection --------------------------------------------------

export const ProjectionStepSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  targetsCriteria: z.array(z.string().min(1)).min(1),
  expectedEvidence: z.array(z.string()).default([]),
})
export type ProjectionStep = z.infer<typeof ProjectionStepSchema>

export const PlanProjectionEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/plan-projection'),
  specId: z.string().min(1),
  projectionId: z.string().min(1),
  steps: z.array(ProjectionStepSchema).min(1),
  rationale: z.string().min(1),
})

// ---- gungnir/commit -----------------------------------------------------------

export const CommitEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/commit'),
  specId: z.string().min(1),
  /** 从 1 起严格递增；每轮恰好一个 committed action（一阶段约束） */
  round: z.number().int().positive(),
  actionId: z.string().min(1),
  summary: z.string().min(1),
  targetsCriteria: z.array(z.string().min(1)).min(1),
  expectedEvidence: z.array(z.string()).default([]),
  /** 溯源：本 action 来自哪份 projection */
  projectionId: z.string().nullable().default(null),
  /** 溯源：本 action 对应 projection 的哪个 step（RETRY 重提交时保留原 stepId） */
  stepId: z.string().nullable().default(null),
})

// ---- gungnir/evidence ---------------------------------------------------------

export const EvidenceSourceSchema = z.enum(['tool_result', 'file', 'exit_code', 'env'])

export const EvidenceEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/evidence'),
  specId: z.string().min(1),
  /** 0 = 轮前基线采样；≥1 必须已有对应 commit */
  round: z.number().int().nonnegative(),
  evidenceId: z.string().min(1),
  source: EvidenceSourceSchema,
  /** locator：工具调用 {turn,step,tool,callId} 编码、文件路径或命令串；大内容只存 digest + ref */
  ref: z.string().min(1),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  /** 短预览（spill 精神），默认空串 */
  preview: z.string().default(''),
})

// ---- gungnir/claim ------------------------------------------------------------

export const AssertedOutcomeSchema = z.enum(['done', 'partial', 'failed', 'blocked'])

export const ClaimEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/claim'),
  specId: z.string().min(1),
  round: z.number().int().positive(),
  actionId: z.string().min(1),
  summary: z.string().min(1),
  assertedOutcome: AssertedOutcomeSchema,
  /** 引用的 evidenceId 列表；claim 永远只是 claim，verdict 由 harness 依据 evidence 裁决 */
  evidenceRefs: z.array(z.string()).default([]),
})

// ---- gungnir/verdict ----------------------------------------------------------

export const VerdictOutcomeSchema = z.enum(['PASS', 'FAIL', 'PARTIAL', 'INCONCLUSIVE', 'STALE', 'NEEDS_HUMAN'])
export type VerdictOutcome = z.infer<typeof VerdictOutcomeSchema>

/** 产生 verdict 的 verifier 种类：三种机器 verifier；human 谓词不走 verdict（走 NEEDS_HUMAN 决策）。 */
export const VerifierKindSchema = z.enum(['exit_code', 'artifact', 'llm_rubric'])
export type VerifierKind = z.infer<typeof VerifierKindSchema>

/** 一阶段 verifier 等级：L1/L2/L4。 */
export const MachineVerifierLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(4)])

export const VerdictEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/verdict'),
  specId: z.string().min(1),
  criterionId: z.string().min(1),
  round: z.number().int().positive(),
  verifier: z.object({
    level: MachineVerifierLevelSchema,
    kind: VerifierKindSchema,
  }),
  outcome: VerdictOutcomeSchema,
  /** 失败签名（transient 判定依据）；FAIL 时必须非空 */
  errorSignature: z.string().default(''),
  /** evidence locator（本次裁决依据的证据指针） */
  detailRef: z.string().default(''),
})

// ---- gungnir/status -----------------------------------------------------------

export const PhaseSchema = z.enum([
  'SPEC_COMMITTED',
  'EXECUTING',
  'VERIFYING',
  'REVALIDATING',
  'COMPLETE',
  'BLOCKED',
  'NEEDS_HUMAN',
])
export type Phase = z.infer<typeof PhaseSchema>

export const ProgressSnapshotSchema = z.object({
  satisfied: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  verifiedArtifacts: z.number().int().nonnegative().default(0),
  roundsNoImprovement: z.number().int().nonnegative().default(0),
})
export type ProgressSnapshot = z.infer<typeof ProgressSnapshotSchema>

export const DecisionKindSchema = z.enum([
  'ADVANCE',
  'REPLAN',
  'RETRY',
  'BLOCKED',
  'NEEDS_HUMAN',
  'REVALIDATE',
  'COMPLETE',
  'RESUME',
])
export type DecisionKind = z.infer<typeof DecisionKindSchema>

export const StatusEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/status'),
  specId: z.string().min(1),
  phase: PhaseSchema,
  satisfiedCriteria: z.array(z.string()).default([]),
  progressSnapshot: ProgressSnapshotSchema,
  /** BLOCKED 时必填（机器可读 blocker code，lower-kebab-case，对齐 GoalBlockReason.code） */
  blocker: z.string().default(''),
  /** 触发本状态转换的决策；RESUME 表示人侧恢复。可选（审计字段） */
  decision: DecisionKindSchema.optional(),
})

// ---- gungnir/loop-state / gungnir/loop-transition（二阶段 M1 接入，ADR-0005 预留放开） ----
//
// 语义（ADR-0014/0015）：
// - loop-transition：模式发生真实切换（含首次选定 from=null）时落账；rule 是命中的
//   router 决策规则标识（可审计）；hysteresis 预算耗尽的保持不落 transition（没有
//   切换就没有事件），保持行为由后续 loop-state 的 mode 快照体现。
// - loop-state：模式快照锚点（切换后必落；turn 边界由 driver 补锚）。快照必须与
//   fold 派生的当前模式一致（单一真理，同 status 快照纪律）。

export const LoopModeSchema = z.enum(['FAST', 'EXECUTE', 'VERIFY'])
export type LoopMode = z.infer<typeof LoopModeSchema>

export const LoopStateEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/loop-state'),
  mode: LoopModeSchema,
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  /** 已发生的 transition 总数（fold 派生校验） */
  transitionsCount: z.number().int().nonnegative(),
})

export const LoopTransitionEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/loop-transition'),
  from: LoopModeSchema.nullable(),
  to: LoopModeSchema,
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  /** 命中的 router 规则（router.ts LoopRouteDecision['rule']；hysteresis 保持不落账） */
  rule: z.string().min(1),
})

// ---- union --------------------------------------------------------------------

export const GungnirEventSchema = z.discriminatedUnion('type', [
  SpecEventSchema,
  PlanProjectionEventSchema,
  CommitEventSchema,
  EvidenceEventSchema,
  ClaimEventSchema,
  VerdictEventSchema,
  StatusEventSchema,
  LoopStateEventSchema,
  LoopTransitionEventSchema,
  PassiveInvariantEventSchema,
  PassiveCaptureEventSchema,
  PassiveAssessmentEventSchema,
  PassiveInterventionEventSchema,
])

export type SpecEvent = z.infer<typeof SpecEventSchema>
export type PlanProjectionEvent = z.infer<typeof PlanProjectionEventSchema>
export type CommitEvent = z.infer<typeof CommitEventSchema>
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>
export type ClaimEvent = z.infer<typeof ClaimEventSchema>
export type VerdictEvent = z.infer<typeof VerdictEventSchema>
export type StatusEvent = z.infer<typeof StatusEventSchema>
export type LoopStateEvent = z.infer<typeof LoopStateEventSchema>
export type LoopTransitionEvent = z.infer<typeof LoopTransitionEventSchema>
export type PassiveInvariantEvent = z.infer<typeof PassiveInvariantEventSchema>
export type PassiveCaptureEvent = z.infer<typeof PassiveCaptureEventSchema>
export type PassiveAssessmentEvent = z.infer<typeof PassiveAssessmentEventSchema>
export type PassiveInterventionEvent = z.infer<typeof PassiveInterventionEventSchema>
export type { ConflictDetail, S2Capture }
export type GungnirEvent = z.infer<typeof GungnirEventSchema>

/** 解析单个事件；schema 不合法即抛 zod 错误（调用方转成 FoldError，停在坏事件处）。 */
export function parseGungnirEvent(raw: unknown): GungnirEvent {
  return GungnirEventSchema.parse(raw)
}

export interface NewEventInput {
  ts: number
}

/** 事件构造辅助：统一打 v:1 信封。 */
export function makeEvent<T extends { type: GungnirEventType }>(type: T, ts: number): T & { v: 1; ts: number } {
  return { ...type, v: 1 as const, ts }
}

/** 从事件流提取 spec（第一个 gungnir/spec 事件；一阶段单 spec 假设下的便利函数）。 */
export function firstSpecOf(events: readonly GungnirEvent[]): GoalSpec | null {
  for (const event of events) {
    if (event.type === 'gungnir/spec') return event.spec
  }
  return null
}
