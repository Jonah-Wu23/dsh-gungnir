import { z } from 'zod'
import { EventEnvelopeFieldsSchema } from './envelope.ts'

/**
 * 被动面（Passive Plane）schema —— 三阶段 P1（ADR-0017）。
 *
 * 与协议面（spec/plan/commit/report）正交：被动面没有 GoalSpec、没有轮次、没有
 * committed action。判据来源三层（spike 计划 §4）：
 * - S1 通用不变量：结构事件（tool/call、tool/result、wrapup）派生，零协议成本；
 * - S2 一次性轻量捕获：session 开头 1 个额外 trip，主 Agent 声明预期产物/验证命令/约束；
 * - S3 外部供给：harness 配置 / CI（spike 中由跑批器扮演，不进入插件运行面）。
 *
 * 事件都是 advisory（fold 不推进 Goal 状态机，只做 schema 校验 + 落账）。
 */

/** S2 一次性捕获（gungnir_capture 工具载荷；全部 L1/L2 可判定，禁 L4）。 */
export const S2CaptureSchema = z.object({
  /** 预期产物：workspace 相对路径 + 存在性/包含断言（L2 语义）。 */
  expectedArtifacts: z
    .array(
      z.object({
        path: z.string().min(1),
        mustExist: z.boolean().default(true),
        contains: z.string().optional(),
      }),
    )
    .default([]),
  /** 验证命令：wrapup 时由 harness 执行器跑（L1 语义，禁 L4）。 */
  verifyCommands: z
    .array(
      z.object({
        command: z.string().min(1),
        expectedExitCode: z.number().int().default(0),
        timeoutMs: z.number().int().positive().max(600_000).default(60_000),
      }),
    )
    .default([]),
  /** 约束：禁改文件（内容快照比对）+ 禁新增依赖（清单文件变更比对）。 */
  constraints: z
    .object({
      noModifyFiles: z.array(z.string()).default([]),
      noNewDeps: z.boolean().default(false),
    })
    .default({ noModifyFiles: [], noNewDeps: false }),
})
export type S2Capture = z.infer<typeof S2CaptureSchema>

/** 冲突种类（评估与 MAF 的原子事实；全部可落账、可审计）。P2 新增：probe-failed
 *（M-A harness 侧隐藏输入探针失败，VERIFY 终判依据）、unverifiable-claim（对含
 * 沙箱外判据的目标宣称完全完成——M-C 三态进被动面）。 */
export const ConflictKindSchema = z.enum([
  'sandbox-denied',
  'tool-error',
  'test-failure',
  'write-outside-workspace',
  'artifact-missing',
  'verify-command-failed',
  'file-modified',
  'new-deps',
  'probe-failed',
  'unverifiable-claim',
])
export type ConflictKind = z.infer<typeof ConflictKindSchema>

export const ConflictDetailSchema = z.object({
  kind: ConflictKindSchema,
  /** evidence locator（工具调用指针 / 路径 / 命令串） */
  ref: z.string().min(1),
  /** 任务级人类可读描述（AP-6：进 prompt 的材料，不含控制面内部概念） */
  detail: z.string().min(1),
})
export type ConflictDetail = z.infer<typeof ConflictDetailSchema>

export const InvariantSeveritySchema = z.enum(['error', 'warning'])
export type InvariantSeverity = z.infer<typeof InvariantSeveritySchema>

// ---- gungnir/invariant ---------------------------------------------------------
//
// S1 不变量观测：每个触发事件落一条。severity：error = 本次完成声明必冲突；
// warning = 时间序相关（test-failure 可能在 wrapup 前被后续测试运行翻转为 pass）。

export const PassiveInvariantEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/invariant'),
  invariantId: z.enum(['tool-error', 'sandbox-denied', 'test-failure', 'write-outside-workspace']),
  severity: InvariantSeveritySchema,
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  ref: z.string().min(1),
  detail: z.string().default(''),
})

// ---- gungnir/capture -----------------------------------------------------------

export const PassiveCaptureEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/capture'),
  capture: S2CaptureSchema,
})

// ---- gungnir/assessment --------------------------------------------------------
//
// wrapup 评估（agent 调 update_goal complete/blocked 的收尾点）：一次评估一条。
// outcome=silent：无冲突，零打扰；outcome=intervene：有冲突，注入 MAF。

export const PassiveAssessmentEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/assessment'),
  outcome: z.enum(['silent', 'intervene']),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  conflicts: z.array(ConflictDetailSchema).default([]),
})

// ---- gungnir/intervention ------------------------------------------------------
//
// MAF 注入（AP-6）：冲突 + 面向任务的反馈原文。内部记录全字段；Agent 只见
// buildMafMessage 产出的任务层文本（内部概念进 ledger，不进 prompt）。

export const PassiveInterventionEventSchema = EventEnvelopeFieldsSchema.extend({
  type: z.literal('gungnir/intervention'),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  conflicts: z.array(ConflictDetailSchema).min(1),
  feedback: z.string().min(1),
})
