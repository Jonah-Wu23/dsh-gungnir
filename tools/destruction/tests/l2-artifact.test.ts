import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256OfString } from 'gungnir-core'
import type { VerifyContext } from 'gungnir-core'
import { ArtifactVerifier } from 'dsh-gungnir/verifiers/artifact.js'
import { tempWorkspace } from './helpers.js'
import { describe, expect, it } from 'vitest'

/**
 * L2（artifact）verifier 契约测试：存在 / 内容包含 / sha256 / JSON 谓词 + 围栏。
 * 重点回归：mustExist:false 的语义是"必须缺席"，文件存在必须 FAIL
 * （修复前会落 PASS —— 一条真实的假验收通道，由 20 任务实验的 a20 暴露）。
 */

function artifactContext(dir: string): VerifyContext {
  return {
    workspaceRoot: dir,
    async runCommand() {
      throw new Error('l2 test: no command executor')
    },
    async readFile() {
      return null
    },
    async completeRubric() {
      throw new Error('l2 test: no llm')
    },
    now: () => Date.now(),
  }
}

function criterion(predicate: {
  path: string
  mustExist: boolean
  contains?: string
  sha256?: string
  jsonPath?: string
  jsonEquals?: unknown
}) {
  return {
    id: 'c1',
    description: 'artifact criterion',
    predicate: { kind: 'artifact' as const, ...predicate },
    verifierLevel: 2 as const,
  }
}

describe('L2 artifact verifier', () => {
  it('PASSes when the file exists and contains the marker', async () => {
    const dir = tempWorkspace()
    writeFileSync(join(dir, 'a.md'), 'hello MARKER world')
    const verifier = new ArtifactVerifier()
    const result = await verifier.verify(criterion({ path: 'a.md', mustExist: true, contains: 'MARKER' }), artifactContext(dir))
    expect(result.outcome).toBe('PASS')
    expect(result.evidence?.digest).toBe(sha256OfString('hello MARKER world'))
  })

  it('FAILs when a required file is missing', async () => {
    const dir = tempWorkspace()
    const verifier = new ArtifactVerifier()
    const result = await verifier.verify(criterion({ path: 'nope.md', mustExist: true }), artifactContext(dir))
    expect(result.outcome).toBe('FAIL')
    expect(result.errorSignature).toContain('artifact-missing')
  })

  it('PASSes when an absent file is required to be absent (mustExist:false)', async () => {
    const dir = tempWorkspace()
    const verifier = new ArtifactVerifier()
    const result = await verifier.verify(criterion({ path: 'absent.md', mustExist: false }), artifactContext(dir))
    expect(result.outcome).toBe('PASS')
    expect(result.detailRef).toContain('absent as required')
  })

  it('FAILs when a file that must be absent exists (false-acceptance regression)', async () => {
    const dir = tempWorkspace()
    writeFileSync(join(dir, 'present.md'), 'i should not be here')
    const verifier = new ArtifactVerifier()
    const result = await verifier.verify(criterion({ path: 'present.md', mustExist: false }), artifactContext(dir))
    expect(result.outcome).toBe('FAIL')
    expect(result.errorSignature).toContain('artifact-present')
    expect(result.evidence?.preview).toContain('i should not be here')
  })

  it('reports STALE on sha256 drift (world moved, not a plain failure)', async () => {
    const dir = tempWorkspace()
    writeFileSync(join(dir, 'pinned.md'), 'v1')
    const verifier = new ArtifactVerifier()
    const result = await verifier.verify(
      criterion({ path: 'pinned.md', mustExist: true, sha256: sha256OfString('v2') }),
      artifactContext(dir),
    )
    expect(result.outcome).toBe('STALE')
    expect(result.errorSignature).toContain('artifact-drift')
  })

  it('FAILs on a JSON path that is absent and STALE when it drifts', async () => {
    const dir = tempWorkspace()
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ a: { b: 1 } }))
    const verifier = new ArtifactVerifier()
    const missing = await verifier.verify(criterion({ path: 'data.json', mustExist: true, jsonPath: 'a.z' }), artifactContext(dir))
    expect(missing.outcome).toBe('FAIL')
    expect(missing.errorSignature).toContain('artifact-json-missing')

    const drifted = await verifier.verify(criterion({ path: 'data.json', mustExist: true, jsonPath: 'a.b', jsonEquals: 2 }), artifactContext(dir))
    expect(drifted.outcome).toBe('STALE')
    expect(drifted.errorSignature).toContain('artifact-json-drift')
  })

  it('refuses paths outside the workspace fence', async () => {
    const dir = tempWorkspace()
    const verifier = new ArtifactVerifier()
    const result = await verifier.verify(criterion({ path: '../outside.md', mustExist: true }), artifactContext(dir))
    expect(result.outcome).toBe('FAIL')
    expect(result.errorSignature).toContain('path-outside-workspace')
    expect(result.evidence).toBeNull()
  })
})
