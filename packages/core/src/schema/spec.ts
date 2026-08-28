import { z } from 'zod'

/**
 * GoalSpec（版本化目标契约）与谓词 schema —— ledger schema v1（M0 冻结）。
 * 约定：envelope 携带 v/ts，payload 只含域字段；全部 JSON-safe。
 */

/** Verifier 阶梯（一阶段）：L1 deterministic / L2 artifact / L4 semantic / L5 human（仅 NEEDS_HUMAN 出口）。L3 external-state 二阶段引入。 */
export const VerifierLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(5),
])
export type VerifierLevel = z.infer<typeof VerifierLevelSchema>

export const PredicateKindSchema = z.enum(['exit_code', 'artifact', 'llm_rubric', 'human'])
export type PredicateKind = z.infer<typeof PredicateKindSchema>

/** kind → 阶梯等级的权威映射（Spec 与 Verdict 的一致性都以此校验）。 */
export function levelForKind(kind: PredicateKind): VerifierLevel {
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

export const ExitCodePredicateSchema = z.object({
  kind: z.literal('exit_code'),
  /** pwsh 语义命令（Windows 栈；声明跨平台语义由 Spec 作者负责） */
  command: z.string().min(1),
  expectedExitCode: z.number().int().default(0),
  stdoutContains: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).default(60_000),
})

export const ArtifactPredicateSchema = z.object({
  kind: z.literal('artifact'),
  /** workspace 相对路径（安全边界不越 sandbox，由宿主执行器保证） */
  path: z.string().min(1),
  mustExist: z.boolean().default(true),
  contains: z.string().optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** dot-path（如 `a.b.0.c`）；与 jsonEquals 联用做 JSON 谓词 */
  jsonPath: z.string().optional(),
  jsonEquals: z.unknown().optional(),
})

export const LlmRubricPredicateSchema = z.object({
  kind: z.literal('llm_rubric'),
  rubric: z.string().min(1),
  /** 0–1 阈值；LLM rubric 永远标记低可信（见 ladder 强制规则） */
  passThreshold: z.number().min(0).max(1).default(0.8),
  /**
   * 待评审成果的 workspace 相对路径（经 VerifyContext.readFile 的 fence 读取）。
   * 缺省 = 评审对象不可定位：verifier 一律返回 INCONCLUSIVE（fail loud），
   * 绝不凭空对“空气”打分、也绝不把这种无对象裁决当成证据。
   */
  subjectPath: z.string().min(1).optional(),
})

export const HumanPredicateSchema = z.object({
  kind: z.literal('human'),
  question: z.string().min(1),
})

export const PredicateSchema = z.discriminatedUnion('kind', [
  ExitCodePredicateSchema,
  ArtifactPredicateSchema,
  LlmRubricPredicateSchema,
  HumanPredicateSchema,
])
export type Predicate = z.infer<typeof PredicateSchema>

export const SuccessCriterionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    predicate: PredicateSchema,
    verifierLevel: VerifierLevelSchema,
  })
  .superRefine((criterion, ctx) => {
    const expected = levelForKind(criterion.predicate.kind)
    if (criterion.verifierLevel !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `criterion "${criterion.id}": verifierLevel ${criterion.verifierLevel} does not match predicate kind "${criterion.predicate.kind}" (expected ${expected})`,
        path: ['verifierLevel'],
      })
    }
  })
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>

export const BudgetSchema = z.object({
  /** 最大轮次；null = 不限（熔断仍由 no-progress 守卫兜底） */
  maxRounds: z.number().int().positive().nullable().default(null),
  /** Verifier 运行总次数上限（防 rubric 烧 token）；null = 不限 */
  maxVerifierRuns: z.number().int().positive().nullable().default(null),
})
export type Budget = z.infer<typeof BudgetSchema>

export const GoalSpecSchema = z
  .object({
    specId: z.string().min(1),
    version: z.number().int().positive(),
    objective: z.string().min(1),
    successCriteria: z.array(SuccessCriterionSchema).min(1),
    constraints: z.array(z.string()).default([]),
    nonGoals: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
    budget: BudgetSchema.default({ maxRounds: null, maxVerifierRuns: null }),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>()
    for (const criterion of spec.successCriteria) {
      if (seen.has(criterion.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate success criterion id "${criterion.id}"`,
          path: ['successCriteria'],
        })
        return
      }
      seen.add(criterion.id)
    }
  })
export type GoalSpec = z.infer<typeof GoalSpecSchema>

export function parseGoalSpec(raw: unknown): GoalSpec {
  return GoalSpecSchema.parse(raw)
}
