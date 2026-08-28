import { sha256Of } from '@gungnir/core'
import type { CommandObservation, VerifyContext } from '@gungnir/core'
import { ExitCodeVerifier } from 'dsh-gungnir/verifiers/exit-code.js'
import { describe, expect, it } from 'vitest'

/**
 * L1（exit_code）verifier 契约测试：判定逻辑本身（命令通道由 harness 执行器注入，
 * 真机 ctx.shell 形状留待真实 profile 实测——见 docs/context/state.md 下一步）。
 *
 * 纪律：执行器不可用时必须 INCONCLUSIVE（fail loud），绝不把“跑不了”伪装成通过。
 */

function exitContext(observation: CommandObservation | Error): VerifyContext {
  return {
    workspaceRoot: process.cwd(),
    async runCommand(_command, _timeoutMs) {
      if (observation instanceof Error) throw observation
      return observation
    },
    async readFile() {
      return null
    },
    async completeRubric() {
      throw new Error('l1 test: no llm')
    },
    now: () => Date.now(),
  }
}

function criterion(expectedExitCode = 0, stdoutContains?: string, command = 'pwsh -Command "exit 0"') {
  return {
    id: 'c1',
    description: 'the command proves it',
    predicate: {
      kind: 'exit_code' as const,
      command,
      expectedExitCode,
      ...(stdoutContains === undefined ? {} : { stdoutContains }),
      timeoutMs: 60_000,
    },
    verifierLevel: 1 as const,
  }
}

describe('L1 exit_code verifier', () => {
  it('PASSes when the exit code and stdout predicate both hold', async () => {
    const verifier = new ExitCodeVerifier()
    const result = await verifier.verify(criterion(0, 'ALL GREEN'), exitContext({ exitCode: 0, stdout: 'ALL GREEN', stderr: '' }))
    expect(result.outcome).toBe('PASS')
    expect(result.errorSignature).toBe('')
    expect(result.detailRef).toContain('cmd:')
    expect(result.evidence?.source).toBe('exit_code')
    expect(result.evidence?.digest).toBe(
      sha256Of({ exitCode: 0, stdout: 'ALL GREEN', stderr: '' }),
    )
  })

  it('FAILs on a wrong exit code and stamps a comparable error signature', async () => {
    const verifier = new ExitCodeVerifier()
    const result = await verifier.verify(criterion(0), exitContext({ exitCode: 3, stdout: '', stderr: 'boom' }))
    expect(result.outcome).toBe('FAIL')
    expect(result.errorSignature).not.toBe('')
    expect(result.errorSignature).toBe(sha256Of({ kind: 'exit-code', exitCode: 3, stderrHead: 'boom' }))
    expect(result.detailRef).toContain('exit 3')
  })

  it('FAILs when the stdout predicate misses even though the exit code matches', async () => {
    const verifier = new ExitCodeVerifier()
    const result = await verifier.verify(criterion(0, 'MAGIC'), exitContext({ exitCode: 0, stdout: 'nothing here', stderr: '' }))
    expect(result.outcome).toBe('FAIL')
    expect(result.detailRef).toContain('stdout predicate miss')
  })

  it('reports INCONCLUSIVE when the harness executor is unavailable (never fakes success)', async () => {
    const verifier = new ExitCodeVerifier()
    const result = await verifier.verify(criterion(0), exitContext(new Error('ctx.shell unavailable')))
    expect(result.outcome).toBe('INCONCLUSIVE')
    expect(result.detailRef).toContain('runner-unavailable')
    expect(result.evidence).toBeNull()
  })
})
