import { z } from 'zod'
import { sha256OfString } from '@gungnir/core'
import {
  expectPredicate,
  type SuccessCriterion,
  type Verifier,
  type VerifierResult,
  type VerifyContext,
} from '@gungnir/core'

/**
 * L4 LlmRubric verifier：按 rubric 语义评分。低可信通道——
 * - 强 schema 输出（score/rationale），解析失败 = INCONCLUSIVE；
 * - prompt hash 记入 detailRef（可审计）；
 * - 本 verifier 返回的 PASS 会在 core 的 effectiveOutcome 降级为 PARTIAL：
 *   纯语义判定永远不足以支撑最终 PASS（阶梯强制规则）。
 */

const RubricAnswerSchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().min(1),
})

function buildPrompt(criterionDescription: string, rubric: string, passThreshold: number): string {
  return [
    'You are a strict acceptance reviewer. Judge ONLY against the rubric. Reply with a single JSON object and nothing else.',
    JSON.stringify({ format: { score: 'number in [0,1]', rationale: 'one short paragraph' } }),
    `Criterion: ${criterionDescription}`,
    `Rubric: ${rubric}`,
    `pass threshold: score >= ${passThreshold}`,
  ].join('\n')
}

export class LlmRubricVerifier implements Verifier {
  readonly kind = 'llm_rubric' as const
  readonly level = 4 as const

  async verify(criterion: SuccessCriterion, ctx: VerifyContext): Promise<VerifierResult> {
    const predicate = expectPredicate<{ kind: 'llm_rubric'; rubric: string; passThreshold: number }>(criterion, 'llm_rubric', 4)
    const prompt = buildPrompt(criterion.description, predicate.rubric, predicate.passThreshold)
    const promptHash = sha256OfString(prompt).slice(0, 16)
    try {
      const answerText = await ctx.completeRubric(prompt)
      const jsonMatch = answerText.match(/\{[\s\S]*\}/)
      const parsed = RubricAnswerSchema.safeParse(jsonMatch === null ? null : JSON.parse(jsonMatch[0]))
      if (!parsed.success) {
        return {
          outcome: 'INCONCLUSIVE',
          errorSignature: '',
          detailRef: `rubric:${promptHash} unparseable answer`,
          evidence: null,
        }
      }
      const { score, rationale } = parsed.data
      const evidence = {
        source: 'env' as const,
        ref: `rubric:${promptHash}`,
        digest: sha256OfString(answerText),
        preview: `score=${score} ${rationale.slice(0, 160)}`,
      }
      if (score >= predicate.passThreshold) {
        return { outcome: 'PASS', errorSignature: '', detailRef: `rubric:${promptHash} score=${score} (low trust)`, evidence }
      }
      return {
        outcome: 'FAIL',
        errorSignature: `rubric-below-threshold:${promptHash}`,
        detailRef: `rubric:${promptHash} score=${score} < ${predicate.passThreshold} (low trust)`,
        evidence,
      }
    } catch (error) {
      return {
        outcome: 'INCONCLUSIVE',
        errorSignature: '',
        detailRef: `rubric:${promptHash} llm unavailable: ${error instanceof Error ? error.message : String(error)}`,
        evidence: null,
      }
    }
  }
}
