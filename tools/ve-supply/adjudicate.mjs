/**
 * ve-supply/adjudicate.mjs — 治疗臂判定器（现役离线判定栈 + 四药方）。
 *
 * 来源：tools/experiments/ve-bench/stack/adjudicate.mjs（M3，冻结实验资产，未改动）。
 * 差异点（如实随档代码重复）：
 * - 输入从"夹具目录"改为"契约投影 + 显式 buggy 基底（git 快照）+ 显式 tool-log 路径"；
 * - 不再有控制臂（medicines=[]）形态——供给闭环只跑治疗臂全供给（契约缺什么，覆盖
 *   报告如实记录，药方自行不 applied）；
 * - 聚合语义与 ve-bench 逐条一致（S1 冲突 / 判据 FAIL / 药方冲突 → FAIL；M-C 沙箱外
 *   判据显式列出 → UNVERIFIABLE；未决 → INCONCLUSIVE；全 PASS → PASS）。
 */
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { ExitCodeVerifier } from '../../packages/dsh-plugin/dist/verifiers/exit-code.js'
import { ArtifactVerifier } from '../../packages/dsh-plugin/dist/verifiers/artifact.js'
import {
  assertNoL4,
  assessS1,
  emptyPassivePlane,
  observeToolEvent,
  parseGoalSpec,
} from '../../packages/core/dist/index.js'
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

/** S1：tool-log（GroundingEvent JSONL）→ passive 面 fold → assessS1。 */
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
 * 治疗臂全供给裁决。
 * @param {object} options
 * @param {string} options.workspace 交付工作区
 * @param {object} options.supplied 契约投影（contractToSupplied 产物）
 * @param {string|undefined} options.buggyBaseDir git 快照提取的 buggy 基底（M-B）
 * @param {string|undefined} options.toolLogPath toollog.mjs 提取的 tool-log（S1/M-D）
 */
export async function adjudicate({ workspace, supplied, buggyBaseDir, toolLogPath }) {
  const ctx = runnerContext(workspace)

  // 1. 判据接受面：现役 schema 解析 + L4 守卫（解析失败 → INCONCLUSIVE，loud fail）
  let spec
  try {
    spec = parseGoalSpec({
      specId: supplied.objective.slice(0, 40) || 'dispatch',
      version: 1,
      objective: supplied.objective,
      successCriteria: supplied.criteria,
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

  // 3. S1 通用不变量（无 tool-log → 空）
  const s1Conflicts = toolLogPath !== undefined && toolLogPath !== '' ? s1ConflictsFrom(toolLogPath, workspace) : []

  // 4. 药方（M-B 缺 buggy 基底 / M-D 缺 tool-log 时各自如实降级，不假装）
  const medicineResults = []
  for (const id of ['M-A', 'M-B', 'M-C', 'M-D']) {
    const apply = MEDICINES[id]
    if (apply === undefined) throw new Error(`unknown medicine ${id}`)
    medicineResults.push({ id, ...(await apply({ workspace, supplied, buggyBaseDir, toolLogPath })) })
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
