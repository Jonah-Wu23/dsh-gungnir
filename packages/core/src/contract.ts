/**
 * 派发契约（Dispatch Contract）—— 钓鱼题供给的唯一渠道（ADR-0020 / B2）。
 *
 * 权威文档：docs/plan/派发契约-v0.md（B1）。两边对不上时先改文档再改码，不许漂移。
 * 纯函数层（零 DSH 依赖）：契约 zod schema + 契约 → supplied 四块投影 + 供给覆盖报告。
 * 执行面（snapshot / toollog / run-supply）在 tools/ve-supply/，不 import 本文件的 DSH 依赖。
 *
 * 投影语义（与契约文档 §1 对应）：
 * - provable L1（command 判据）→ 控制臂判据 {kind:'exit_code'} + replay.evidence；
 * - provable L2（artifact 判据）→ 控制臂判据 {kind:'artifact'}；
 * - observability === 'sandbox-external' → unverifiableCriteria（不进控制臂判据，
 *   按 ADR-0004/0009 显式列为不可证，终局非完全 PASS）；
 * - api / grounding 直传；baselineRef → replay.buggyRef（git 快照来源，M-B 基底）。
 */
import { z } from 'zod'
import type { SuccessCriterion } from './schema/spec.ts'
import type { UnverifiableCriterion } from './ve.ts'

// ---- schema v0（权威：契约文档 §1 字段表） ----------------------------------------

export const ObservabilitySchema = z.enum(['provable', 'sandbox-external'])
export type Observability = z.infer<typeof ObservabilitySchema>

export const L1AcceptanceSchema = z.object({
  verifierLevel: z.literal(1),
  id: z.string().min(1),
  description: z.string().min(1),
  /** 验证命令：由派发者一次性声明（runner 侧 spawnSync 执行，ADR-0018 §2 纪律） */
  command: z.string().min(1),
  expectedExitCode: z.number().int().default(0),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  observability: ObservabilitySchema.default('provable'),
})
export type L1Acceptance = z.infer<typeof L1AcceptanceSchema>

export const L2PredicateSchema = z.object({
  kind: z.literal('artifact'),
  path: z.string().min(1),
  mustExist: z.boolean().default(true),
  contains: z.string().optional(),
})
export type L2Predicate = z.infer<typeof L2PredicateSchema>

export const L2AcceptanceSchema = z.object({
  verifierLevel: z.literal(2),
  id: z.string().min(1),
  description: z.string().min(1),
  predicate: L2PredicateSchema,
  observability: ObservabilitySchema.default('provable'),
})
export type L2Acceptance = z.infer<typeof L2AcceptanceSchema>

export const AcceptanceCriterionSchema = z.discriminatedUnion('verifierLevel', [
  L1AcceptanceSchema,
  L2AcceptanceSchema,
])
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>

/** M-A 模板声明：模板名必须存在于 harness 模板库（pricing-round-once / pipeline-validation / ledger-reentry / effectively-once）。 */
export const ApiSupplySchema = z.object({
  module: z.string().min(1),
  function: z.string().min(1),
  template: z.enum(['pricing-round-once', 'pipeline-validation', 'ledger-reentry', 'effectively-once']),
  signature: z.record(z.string(), z.unknown()).optional(),
})
export type ApiSupply = z.infer<typeof ApiSupplySchema>

/** M-D 依据声明：output（写）前须读 source（read→write 时序）。 */
export const ContractGroundingDependencySchema = z.object({
  output: z.string().min(1),
  source: z.string().min(1),
})
export type ContractGroundingDependency = z.infer<typeof ContractGroundingDependencySchema>

/** M-B buggy 基底：派发点工作区快照（git commit；snapshot.mjs 用 git archive 提取）。 */
export const BaselineRefSchema = z.object({
  type: z.literal('git'),
  commit: z.string().min(1),
})
export type BaselineRef = z.infer<typeof BaselineRefSchema>

export const DispatchBudgetSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  maxSeconds: z.number().int().positive().optional(),
})
export type ContractBudget = z.infer<typeof DispatchBudgetSchema>

export const DispatchContractSchema = z
  .object({
    /** 一句话任务目标（裁决上下文） */
    objective: z.string().min(1),
    acceptance: z.array(AcceptanceCriterionSchema).min(1),
    api: ApiSupplySchema.optional(),
    grounding: z.array(ContractGroundingDependencySchema).optional(),
    baselineRef: BaselineRefSchema.optional(),
    budget: DispatchBudgetSchema.optional(),
    /** 治理元数据：不进裁决，只进供给覆盖报告 */
    taskId: z.string().optional(),
    dispatcher: z.string().optional(),
  })
  .superRefine((contract, ctx) => {
    const seen = new Set<string>()
    for (const criterion of contract.acceptance) {
      if (seen.has(criterion.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate acceptance id "${criterion.id}"`,
          path: ['acceptance'],
        })
        return
      }
      seen.add(criterion.id)
    }
  })
export type DispatchContract = z.infer<typeof DispatchContractSchema>

export function parseDispatchContract(raw: unknown): DispatchContract {
  return DispatchContractSchema.parse(raw)
}

// ---- 投影：契约 → supplied 四块 ----------------------------------------------------

export interface ReplayEvidence {
  readonly id: string
  readonly command: string
  readonly expectedExitCode: number
  readonly timeoutMs: number
}

/** 声称的验证证据 v0 = 契约声明的 provable L1 command 判据（最诚实，契约文档 §1）。 */
export function replayEvidenceFrom(contract: DispatchContract): ReplayEvidence[] {
  return contract.acceptance
    .filter((criterion): criterion is L1Acceptance => criterion.verifierLevel === 1 && criterion.observability === 'provable')
    .map((criterion) => ({
      id: criterion.id,
      command: criterion.command,
      expectedExitCode: criterion.expectedExitCode,
      timeoutMs: criterion.timeoutMs,
    }))
}

export interface SuppliedProjection {
  readonly objective: string
  readonly criteria: SuccessCriterion[]
  readonly api?: { module: string; function: string; template: string; signature?: Record<string, unknown> }
  readonly replay?: { evidence: ReplayEvidence[]; buggyRef: { type: 'git'; commit: string } }
  readonly unverifiableCriteria?: UnverifiableCriterion[]
  readonly grounding?: { dependencies: ContractGroundingDependency[] }
}

/** 契约 → supplied 四块（零 DSH 依赖纯函数）。 */
export function contractToSupplied(contract: DispatchContract): SuppliedProjection {
  const criteria: SuccessCriterion[] = []
  const unverifiableCriteria: UnverifiableCriterion[] = []
  for (const criterion of contract.acceptance) {
    if (criterion.observability === 'sandbox-external') {
      unverifiableCriteria.push({ id: criterion.id, description: criterion.description })
      continue
    }
    if (criterion.verifierLevel === 1) {
      criteria.push({
        id: criterion.id,
        description: criterion.description,
        verifierLevel: 1,
        predicate: {
          kind: 'exit_code',
          command: criterion.command,
          expectedExitCode: criterion.expectedExitCode,
          timeoutMs: criterion.timeoutMs,
        },
      })
    } else {
      criteria.push({
        id: criterion.id,
        description: criterion.description,
        verifierLevel: 2,
        predicate: { ...criterion.predicate },
      })
    }
  }

  const supplied: SuppliedProjection = {
    objective: contract.objective,
    criteria,
    ...(contract.api !== undefined
      ? {
          api: {
            module: contract.api.module,
            function: contract.api.function,
            template: contract.api.template,
            ...(contract.api.signature !== undefined ? { signature: contract.api.signature } : {}),
          },
        }
      : {}),
    ...(unverifiableCriteria.length > 0 ? { unverifiableCriteria } : {}),
    ...(contract.grounding !== undefined && contract.grounding.length > 0
      ? { grounding: { dependencies: contract.grounding } }
      : {}),
  }
  if (contract.baselineRef !== undefined) {
    const evidence = replayEvidenceFrom(contract)
    if (evidence.length > 0) {
      return { ...supplied, replay: { evidence, buggyRef: { type: 'git', commit: contract.baselineRef.commit } } }
    }
  }
  return supplied
}

// ---- 供给覆盖报告 -----------------------------------------------------------------

export type MedicineId = 'M-A' | 'M-B' | 'M-C' | 'M-D'

export interface SupplyStatus {
  readonly medicine: MedicineId
  readonly status: 'applied' | 'not-applied'
  /** not-applied 时如实记录原因（Let It Fail：供给缺失可见，不吞） */
  readonly reason?: string
}

export type SupplyCoverage = SupplyStatus[]

/** 每个药方的供给状态：applied / not-applied + 原因（ADR-0020 第 3 条口径）。 */
export function supplyCoverageOf(contract: DispatchContract): SupplyCoverage {
  const hasCommandCriteria = contract.acceptance.some((criterion) => criterion.verifierLevel === 1 && criterion.observability === 'provable')
  const coverage: SupplyCoverage = [
    contract.api !== undefined
      ? { medicine: 'M-A', status: 'applied' }
      : { medicine: 'M-A', status: 'not-applied', reason: 'no api template declared (contract.api missing)' },
    contract.baselineRef !== undefined && hasCommandCriteria
      ? { medicine: 'M-B', status: 'applied' }
      : contract.baselineRef === undefined
        ? { medicine: 'M-B', status: 'not-applied', reason: 'no baselineRef (git snapshot) declared' }
        : { medicine: 'M-B', status: 'not-applied', reason: 'no provable command-class acceptance criteria for replay evidence' },
    contract.acceptance.some((criterion) => criterion.observability === 'sandbox-external')
      ? { medicine: 'M-C', status: 'applied' }
      : { medicine: 'M-C', status: 'not-applied', reason: 'no sandbox-external criteria declared' },
    contract.grounding !== undefined && contract.grounding.length > 0
      ? { medicine: 'M-D', status: 'applied' }
      : { medicine: 'M-D', status: 'not-applied', reason: 'no grounding dependencies declared' },
  ]
  return coverage
}