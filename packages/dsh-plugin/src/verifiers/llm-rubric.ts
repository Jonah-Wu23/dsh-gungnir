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

/** 送进 prompt 的成果正文上限（字符）；超出截断并在 prompt 里声明，避免无限烧 token。 */
const MAX_SUBJECT_CHARS = 20_000

function buildPrompt(criterionDescription: string, rubric: string, passThreshold: number, subject: { path: string; text: string; truncated: boolean }): string {
  return [
    'You are a strict acceptance reviewer. Judge ONLY the SUBJECT against the rubric. Reply with a single JSON object and nothing else.',
    JSON.stringify({ format: { score: 'number in [0,1]', rationale: 'one short paragraph' } }),
    `Criterion: ${criterionDescription}`,
    `Rubric: ${rubric}`,
    `pass threshold: score >= ${passThreshold}`,
    `SUBJECT (${subject.path}${subject.truncated ? `, truncated to ${MAX_SUBJECT_CHARS} chars` : ''}):`,
    '<<<SUBJECT',
    subject.text,
    'SUBJECT>>>',
  ].join('\n')
}

export class LlmRubricVerifier implements Verifier {
  readonly kind = 'llm_rubric' as const
  readonly level = 4 as const

  async verify(criterion: SuccessCriterion, ctx: VerifyContext): Promise<VerifierResult> {
    const predicate = expectPredicate<{ kind: 'llm_rubric'; rubric: string; passThreshold: number; subjectPath?: string }>(
      criterion,
      'llm_rubric',
      4,
    )
    const promptHash = sha256OfString(`${criterion.id}|${predicate.rubric}|${predicate.passThreshold}|${predicate.subjectPath ?? ''}`).slice(0, 16)

    // 评审对象必须可定位：没有 subjectPath 就一律不打分（fail loud，绝不凭空裁决）
    if (predicate.subjectPath === undefined) {
      return {
        outcome: 'INCONCLUSIVE',
        errorSignature: '',
        detailRef: `rubric:${promptHash} no-subject: predicate.subjectPath missing — cannot judge a criterion with no artifact to read`,
        evidence: null,
      }
    }
    const rawSubject = await ctx.readFile(predicate.subjectPath)
    if (rawSubject === null) {
      return {
        outcome: 'INCONCLUSIVE',
        errorSignature: '',
        detailRef: `rubric:${promptHash} subject-unreadable:${predicate.subjectPath} (missing or outside the workspace fence)`,
        evidence: null,
      }
    }
    const subject = {
      path: predicate.subjectPath,
      text: rawSubject.slice(0, MAX_SUBJECT_CHARS),
      truncated: rawSubject.length > MAX_SUBJECT_CHARS,
    }
    const prompt = buildPrompt(criterion.description, predicate.rubric, predicate.passThreshold, subject)
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
