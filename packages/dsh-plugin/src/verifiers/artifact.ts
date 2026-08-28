import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { sha256OfString } from '@gungnir/core'
import {
  expectPredicate,
  type SuccessCriterion,
  type Verifier,
  type VerifierResult,
  type VerifyContext,
} from '@gungnir/core'

/**
 * L2 Artifact verifier：只读检查 workspace 内文件——存在 / 内容包含 / sha256 / JSON 谓词。
 * 安全边界：路径必须解析在 workspaceRoot 之内（resolve 后前缀校验，拒绝越界与绝对路径注入）。
 * 语义：sha256 或 JSON 值不匹配 = 世界漂移 → STALE（触发 REPLAN）；缺失/结构不符 = FAIL。
 */

function containedInWorkspace(workspaceRoot: string, candidate: string): string | null {
  const root = resolve(workspaceRoot)
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
  if (target === root || target.startsWith(root + sep)) return target
  return null
}

function readJsonPath(value: unknown, dotPath: string): { found: true; value: unknown } | { found: false } {
  let current: unknown = value
  for (const segment of dotPath.split('.')) {
    if (current === null || typeof current !== 'object') return { found: false }
    const record = current as Record<string, unknown>
    if (!(segment in record)) return { found: false }
    current = record[segment]
  }
  return { found: true, value: current }
}

export class ArtifactVerifier implements Verifier {
  readonly kind = 'artifact' as const
  readonly level = 2 as const

  async verify(criterion: SuccessCriterion, ctx: VerifyContext): Promise<VerifierResult> {
    const predicate = expectPredicate<{
      kind: 'artifact'
      path: string
      mustExist: boolean
      contains?: string
      sha256?: string
      jsonPath?: string
      jsonEquals?: unknown
    }>(criterion, 'artifact', 2)

    const target = containedInWorkspace(ctx.workspaceRoot, predicate.path)
    if (target === null) {
      return {
        outcome: 'FAIL',
        errorSignature: `path-outside-workspace:${predicate.path}`,
        detailRef: `path:${predicate.path} escapes workspace fence`,
        evidence: null,
      }
    }

    let content: string
    try {
      const raw = await readFile(target, 'utf8')
      content = raw
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (missing && !predicate.mustExist) {
        return { outcome: 'PASS', errorSignature: '', detailRef: `path:${predicate.path} (absent as required)`, evidence: null }
      }
      return {
        outcome: 'FAIL',
        errorSignature: `artifact-missing:${predicate.path}`,
        detailRef: `path:${predicate.path} not readable (${error instanceof Error ? error.message : String(error)})`,
        evidence: null,
      }
    }

    const digest = sha256OfString(content)
    const evidence = {
      source: 'file' as const,
      ref: predicate.path,
      digest,
      preview: content.slice(0, 200),
    }

    // mustExist:false 的语义是"该路径必须缺席"：文件存在即确定性违背判据。
    // （修复前的实现会在文件存在且无其他谓词时落到 PASS —— 一条真实的假验收通道。）
    if (!predicate.mustExist) {
      return {
        outcome: 'FAIL',
        errorSignature: `artifact-present:${predicate.path}`,
        detailRef: `path:${predicate.path} exists but the criterion requires it to be absent`,
        evidence,
      }
    }

    if (predicate.sha256 !== undefined && predicate.sha256 !== digest) {
      return { outcome: 'STALE', errorSignature: `artifact-drift:${predicate.path}`, detailRef: `path:${predicate.path} sha256 mismatch`, evidence }
    }
    if (predicate.contains !== undefined && !content.includes(predicate.contains)) {
      return { outcome: 'FAIL', errorSignature: `artifact-missing-content:${predicate.path}`, detailRef: `path:${predicate.path} lacks "${predicate.contains.slice(0, 80)}"`, evidence }
    }
    if (predicate.jsonPath !== undefined) {
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch (error) {
        return { outcome: 'FAIL', errorSignature: `artifact-invalid-json:${predicate.path}`, detailRef: `path:${predicate.path} json parse failed`, evidence }
      }
      const found = readJsonPath(parsed, predicate.jsonPath)
      if (!found.found) {
        return { outcome: 'FAIL', errorSignature: `artifact-json-missing:${predicate.path}#${predicate.jsonPath}`, detailRef: `path:${predicate.path} jsonPath ${predicate.jsonPath} absent`, evidence }
      }
      if (predicate.jsonEquals !== undefined && JSON.stringify(found.value) !== JSON.stringify(predicate.jsonEquals)) {
        return { outcome: 'STALE', errorSignature: `artifact-json-drift:${predicate.path}#${predicate.jsonPath}`, detailRef: `path:${predicate.path} jsonPath ${predicate.jsonPath} drifted`, evidence }
      }
    }

    return { outcome: 'PASS', errorSignature: '', detailRef: `path:${predicate.path} sha256:${digest.slice(0, 16)}`, evidence }
  }
}
