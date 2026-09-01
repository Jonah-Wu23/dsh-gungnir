import { sha256Of } from 'gungnir-core'
import {
  expectPredicate,
  type SuccessCriterion,
  type Verifier,
  type VerifierResult,
  type VerifyContext,
} from 'gungnir-core'

/**
 * L1 ExitCode verifier：跑 deterministic 命令，裁决 exit code（+可选 stdout 包含）。
 * 命令一律经 VerifyContext.runCommand（harness 执行器端口）——绝不私开进程越权。
 * 执行器未接线时如实返回 INCONCLUSIVE，不伪造成功。
 */
export class ExitCodeVerifier implements Verifier {
  readonly kind = 'exit_code' as const
  readonly level = 1 as const

  async verify(criterion: SuccessCriterion, ctx: VerifyContext): Promise<VerifierResult> {
    const predicate = expectPredicate<{ kind: 'exit_code'; command: string; expectedExitCode: number; stdoutContains?: string; timeoutMs: number }>(
      criterion,
      'exit_code',
      1,
    )
    try {
      const observation = await ctx.runCommand(predicate.command, predicate.timeoutMs)
      const stdout = observation.stdout
      const stdoutOk = predicate.stdoutContains === undefined || stdout.includes(predicate.stdoutContains)
      const passed = observation.exitCode === predicate.expectedExitCode && stdoutOk
      const evidence = {
        source: 'exit_code' as const,
        ref: predicate.command,
        digest: sha256Of({ exitCode: observation.exitCode, stdout, stderr: observation.stderr }),
        preview: `exit=${observation.exitCode} stdout[${stdout.length}]=${stdout.slice(0, 200)}`,
      }
      if (passed) {
        return { outcome: 'PASS', errorSignature: '', detailRef: `cmd:${predicate.command}`, evidence }
      }
      const errorSignature = sha256Of({ kind: 'exit-code', exitCode: observation.exitCode, stderrHead: observation.stderr.slice(0, 500) })
      return {
        outcome: 'FAIL',
        errorSignature,
        detailRef: `cmd:${predicate.command} (exit ${observation.exitCode}${stdoutOk ? '' : ', stdout predicate miss'})`,
        evidence,
      }
    } catch (error) {
      return {
        outcome: 'INCONCLUSIVE',
        errorSignature: '',
        detailRef: `cmd:${predicate.command} runner-unavailable: ${error instanceof Error ? error.message : String(error)}`,
        evidence: null,
      }
    }
  }
}
