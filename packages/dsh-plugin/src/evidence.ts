import { sha256Of } from 'gungnir-core'
import type { EvidenceEvent } from 'gungnir-core'

/**
 * Evidence 捕获（Claim ≠ Evidence 铁律的采集端）：
 * 只把 harness 观测事实（tools/result、文件、exit code、环境采样）转为 gungnir/evidence；
 * 模型输出永远是 claim，走 gungnir/claim，绝不混入本模块。
 *
 * 大内容不入 ledger：只存 digest + locator + ≤200 字符 preview（spill 思路）。
 */

/** 与 dsh-tools 的 ContentBlock 结构对齐的窄视图（只取 text 块）。 */
export interface ContentBlockView {
  readonly type: string
  readonly text?: string
}

/** 与 dsh-tools ToolExecution/ToolExecutionResult 结构对齐的窄视图。 */
export interface ToolResultView {
  readonly callId: string
  readonly name: string
  readonly content: readonly ContentBlockView[]
  readonly isError: boolean
  readonly errorText?: string | undefined
  readonly value?: unknown
}

function textOf(blocks: readonly ContentBlockView[]): string {
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

export interface NewEvidenceInput {
  specId: string
  round: number
  evidenceId: string
  source: EvidenceEvent['source']
  ref: string
  digest: string
  preview: string
}

/** tools/result 观测 → evidence 事件 payload（v/ts envelope 由 ledger.append 统一加盖）。 */
export function evidenceFromToolResult(view: ToolResultView, round: number, specId: string, evidenceId: string): NewEvidenceInput {
  const text = textOf(view.content)
  const digest = sha256Of({
    tool: view.name,
    callId: view.callId,
    isError: view.isError,
    text: text.slice(0, 4000),
    errorText: view.errorText ?? null,
  })
  const ref = `call:${view.callId}#tool:${view.name}`
  const previewBody = view.isError && view.errorText !== undefined ? `error=${view.errorText.slice(0, 200)}` : text.slice(0, 200)
  return {
    specId,
    round,
    evidenceId,
    source: 'tool_result',
    ref,
    digest,
    preview: previewBody,
  }
}

/** 文件采样 → evidence payload（调用方负责 workspace 边界）。 */
export function evidenceFromFile(specId: string, round: number, evidenceId: string, path: string, content: string): NewEvidenceInput {
  return {
    specId,
    round,
    evidenceId,
    source: 'file',
    ref: path,
    digest: sha256Of(content),
    preview: content.slice(0, 200),
  }
}

/** exit code 采样 → evidence payload。 */
export function evidenceFromExitCode(specId: string, round: number, evidenceId: string, command: string, observation: { exitCode: number; stdout: string; stderr: string }): NewEvidenceInput {
  return {
    specId,
    round,
    evidenceId,
    source: 'exit_code',
    ref: command,
    digest: sha256Of(observation),
    preview: `exit=${observation.exitCode} ${observation.stdout.slice(0, 180)}`,
  }
}
