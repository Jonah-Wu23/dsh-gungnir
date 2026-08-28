import type { Predicate, SuccessCriterion, VerifierLevel } from './schema/spec.ts'
import type { VerdictOutcome, VerifierKind } from './schema/events.ts'

/**
 * Verifier 契约（阶梯原则：能用 L1 绝不用 L2，能用 L2 绝不用 L4）。
 * 契约在 core，实现在 dsh-plugin：命令执行走 harness 执行器（不私开进程越权），
 * 文件读取走 fence 内文件服务，LLM rubric 经 ctx.llm。
 */

/** 运行环境由插件注入——core 只定义形状，不 import DSH。 */
export interface VerifyContext {
  /** workspace 根（artifact 路径安全边界） */
  readonly workspaceRoot: string
  /** harness 执行器（pwsh 语义，Windows 栈）；实现必须尊重 timeoutMs */
  runCommand(command: string, timeoutMs: number): Promise<CommandObservation>
  /** fence 内只读文件服务；返回 null = 路径不存在或越界 */
  readFile(path: string): Promise<string | null>
  /** 低可信 LLM 调用（L4 rubric 专用）；返回需由调用方按 schema 自行解析校验 */
  completeRubric(prompt: string): Promise<string>
  now(): number
}

export interface CommandObservation {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface VerifierEvidence {
  readonly source: 'tool_result' | 'file' | 'exit_code' | 'env'
  /** locator：文件路径 / 命令串 / 工具调用指针 */
  readonly ref: string
  /** 内容 digest（sha256 hex），大内容不入 ledger */
  readonly digest: string
  readonly preview: string
}

export interface VerifierResult {
  readonly outcome: VerdictOutcome
  /** 失败签名（FAIL 必填；用于 transient 判定） */
  readonly errorSignature: string
  /** evidence locator（本次裁决依据） */
  readonly detailRef: string
  /** 建议随 verdict 一并落盘的 evidence（插件负责 append gungnir/evidence） */
  readonly evidence: VerifierEvidence | null
}

export interface Verifier {
  readonly kind: VerifierKind
  readonly level: VerifierLevel
  verify(criterion: SuccessCriterion, ctx: VerifyContext): Promise<VerifierResult>
}

/** 断言 criterion 的谓词与本 verifier 匹配（实现方在 verify 入口调用）。 */
export function expectPredicate<P extends Predicate>(criterion: SuccessCriterion, kind: P['kind'], level: VerifierLevel): P {
  if (criterion.predicate.kind !== kind) {
    throw new Error(`verifier kind "${kind}" cannot handle predicate kind "${criterion.predicate.kind}"`)
  }
  if (criterion.verifierLevel !== level) {
    throw new Error(`verifier level ${level} does not match criterion level ${criterion.verifierLevel}`)
  }
  return criterion.predicate as P
}
