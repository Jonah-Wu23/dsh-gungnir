/**
 * stack/adjudicate.mjs — H-VE 控制臂/治疗臂判定器（现役离线判定栈接线）。
 *
 * 控制臂（M2）= 现役栈：L1/L2 verifier（dsh-plugin 现役类，真实现役代码）+ S1 通用
 * 不变量（core passive.ts 纯函数）+ S3 供给判据；对 unverifiableCriteria / replay /
 * grounding / api 视而不见（G0 要测的基线事实）。
 * 治疗臂（M3）= 控制臂 + 药方（M-A~M-D；决策在 core，执行在 medicines.mjs）。
 *
 * 聚合（忠实现役 reconcile 语义，PRE-REGISTRATION §3）：
 * - S1 冲突 / 任一判据 FAIL / 药方冲突 → FAIL（拒绝完成声明）；
 * - M-C 沙箱外判据显式列出 → UNVERIFIABLE（终局非完全 PASS，仅当无 FAIL）；
 * - 任一判据 INCONCLUSIVE/STALE/NEEDS_HUMAN → INCONCLUSIVE；
 * - 全 PASS 且无冲突 → PASS（接受完成声明）。
 * 判据无法按现役 schema 解析（含 unsupported predicate kind）→ INCONCLUSIVE（loud fail）。
 */
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep, join } from 'node:path'
import { ExitCodeVerifier } from '../../../../packages/dsh-plugin/dist/verifiers/exit-code.js'
import { ArtifactVerifier } from '../../../../packages/dsh-plugin/dist/verifiers/artifact.js'
import {
  assertNoL4,
  assessS1,
  emptyPassivePlane,
  observeToolEvent,
  parseGoalSpec,
} from '../../../../packages/core/dist/index.js'
import { MEDICINES } from './medicines.mjs'

/** runner 侧 VerifyContext：cmd 语义 spawnSync + fence 内文件读取（计划 §5 纪律）。 */
function runnerContext(workspace) {
  return {
    workspaceRoot: workspace,
    runCommand: async (command, timeoutMs) => {
      const result = spawnSync(command, {
        shell: true,
        cwd: workspace,
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      })
      if (result.error !== undefined) {
        // 执行器故障：抛错 → L1 verifier 返回 INCONCLUSIVE（loud fail，不伪造成功）
        throw new Error(`runner-unavailable: ${result.error.message}`)
      }
      return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    readFile: async (path) => {
      const root = resolve(workspace)
      const target = resolve(root, path)
      if (target !== root && !target.startsWith(root + sep)) return null
      try {
        return await readFile(target, 'utf8')
      } catch {
        return null
      }
    },
    completeRubric: async () => {
      throw new Error('L4 disabled (ADR-0017)')
    },
    now: () => Date.now(),
  }
}

/** S1：构造 tool-log（ToolEventView JSONL）→ passive 面 fold → assessS1。 */
function s1ConflictsFrom(toolLogPath, workspace) {
  const lines = readFileSync(toolLogPath, 'utf8').trim().split('\n').filter((line) => line !== '')
  let state = emptyPassivePlane()
  for (const line of lines) {
    const event = JSON.parse(line)
    const result = observeToolEvent(state, event, workspace)
    state = result.state
  }
  return assessS1(state)
}

const exitVerifier = new ExitCodeVerifier()
const artifactVerifier = new ArtifactVerifier()

/**
 * 逐夹具判定。medicines = []（控制臂）或 ['M-A','M-B','M-C','M-D']（治疗臂）。
 * @returns 结构化裁决（见 run-bench.mjs 的 row 消费）
 */
export async function adjudicate({ workspace, fixtureDir, supplied, medicines }) {
  const ctx = runnerContext(workspace)

  // 1. 判据接受面：现役 schema 解析 + L4 守卫（解析失败 → INCONCLUSIVE，loud fail）
  let spec
  try {
    spec = parseGoalSpec({
      specId: `ve-${supplied.id ?? 'fixture'}`,
      version: 1,
      objective: supplied.objective ?? 'H-VE fixture',
      successCriteria: supplied.criteria ?? [],
    })
    assertNoL4(spec)
  } catch (error) {
    return {
      stackVerdict: 'INCONCLUSIVE',
      reasons: [`criteria rejected by the current stack: ${error instanceof Error ? error.message : String(error)}`],
      criterionOutcomes: [],
      s1Conflicts: [],
      medicines: [],
      parseRejected: true,
    }
  }

  // 2. 逐判据跑现役 verifier
  const criterionOutcomes = []
  let anyFail = false
  let anyUnresolved = false
  for (const criterion of spec.successCriteria) {
    const kind = criterion.predicate.kind
    const verifier = kind === 'exit_code' ? exitVerifier : kind === 'artifact' ? artifactVerifier : null
    if (verifier === null) {
      criterionOutcomes.push({ id: criterion.id, kind, outcome: 'INCONCLUSIVE', detailRef: `no verifier wired for kind ${kind}` })
      anyUnresolved = true
      continue
    }
    const result = await verifier.verify(criterion, ctx)
    criterionOutcomes.push({ id: criterion.id, kind, outcome: result.outcome, detailRef: result.detailRef })
    if (result.outcome === 'FAIL') anyFail = true
    if (result.outcome === 'INCONCLUSIVE' || result.outcome === 'STALE' || result.outcome === 'NEEDS_HUMAN') anyUnresolved = true
  }

  // 3. S1 通用不变量（有构造 tool-log 的夹具；无 → 空）
  const s1Conflicts = supplied.toolLog !== undefined && existsSync(join(fixtureDir, supplied.toolLog))
    ? s1ConflictsFrom(join(fixtureDir, supplied.toolLog), workspace)
    : []

  // 4. 药方（治疗臂；控制臂 medicines=[] → 全部不 applied）
  const medicineResults = []
  for (const id of medicines) {
    const apply = MEDICINES[id]
    if (apply === undefined) throw new Error(`unknown medicine ${id}`)
    medicineResults.push({ id, ...(await apply({ workspace, fixtureDir, supplied })) })
  }

  // 5. 聚合
  const maMbConflicts = medicineResults
    .filter((m) => (m.id === 'M-A' || m.id === 'M-B') && m.applied === true && m.ok === false)
    .flatMap((m) => m.failures ?? m.details ?? [])
  const mdViolations = medicineResults.find((m) => m.id === 'M-D' && m.applied === true)?.violations ?? []
  const mc = medicineResults.find((m) => m.id === 'M-C' && m.applied === true)
  const unverifiableHandled = mc !== undefined

  const reasons = []
  for (const conflict of s1Conflicts) reasons.push(`S1: ${conflict.kind} — ${conflict.detail}`)
  for (const outcome of criterionOutcomes) {
    if (outcome.outcome !== 'PASS') reasons.push(`criterion ${outcome.id} (${outcome.kind}): ${outcome.outcome} — ${outcome.detailRef}`)
  }
  for (const conflict of maMbConflicts) reasons.push(`medicine: ${conflict}`)
  for (const violation of mdViolations) reasons.push(`medicine: ${violation}`)

  let stackVerdict
  if (anyFail || s1Conflicts.length > 0 || maMbConflicts.length > 0 || mdViolations.length > 0) {
    stackVerdict = 'FAIL'
  } else if (unverifiableHandled) {
    stackVerdict = 'UNVERIFIABLE'
  } else if (anyUnresolved) {
    stackVerdict = 'INCONCLUSIVE'
  } else {
    stackVerdict = 'PASS'
  }

  return {
    stackVerdict,
    reasons,
    criterionOutcomes,
    s1Conflicts,
    medicines: medicineResults,
    unverifiableHandled,
    groundingViolations: mdViolations,
    unverifiableCriteriaCount: supplied.unverifiableCriteria?.length ?? 0,
    replayProvided: supplied.replay !== undefined,
    groundingProvided: supplied.grounding !== undefined,
    apiProvided: supplied.api !== undefined,
  }
}
