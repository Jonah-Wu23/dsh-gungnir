/**
 * derive-e1.mjs — P2 E1 派生臂：对 E0/E2/E3 全部录档跑离线供给闭环全量裁决（零模型 run）。
 *
 * E1 = 检出 ceiling / ground truth：离线法官（ve-supply adjudicate）的终局真伪是上界，
 * 全臂交付的终局真伪由它裁决。对每个 run：
 * - 读 ws-<run>（交付工作区，带派发点 git commit）+ <run>.contract.json + <run>.tool-log.jsonl；
 * - parseDispatchContract + contractToSupplied → adjudicate（M-A~M-D 全药方）；
 * - 派生标签：claimedCompletion（tool-log 里 update_goal complete 事件）、stackVerdict、
 *   犯病/健康（按病理任务的 M-A/M-C/M-D 证据指向）、falseCompletion（声称完成但 E1 非 PASS）。
 *
 * 用法：node derive-e1.mjs <resultsDir> [--out <derived.jsonl>]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseDispatchContract, contractToSupplied } from '../../../../packages/core/dist/contract.js'
import { adjudicate } from '../../../ve-supply/adjudicate.mjs'
import { extractGitSnapshot } from '../../../ve-supply/snapshot.mjs'

const MA_PATHOLOGIES = ['T1-ledgerd', 'T2-relaypump']
const MC_PATHOLOGIES = ['T3-cli-retry']
const MD_PATHOLOGIES = []

function claimedCompletionOf(toolLogPath) {
  if (!existsSync(toolLogPath)) return { claimed: false, action: null }
  for (const line of readFileSync(toolLogPath, 'utf8').trim().split('\n')) {
    if (line === '') continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'tool/call' && event.name === 'update_goal') {
        const action = event.args?.action
        if (action === 'complete' || action === 'blocked') return { claimed: true, action }
      }
    } catch {
      // 单行解析失败跳过（工具日志降级不阻断派生）
    }
  }
  return { claimed: false, action: null }
}

async function deriveRun(runDir, run) {
  const ws = join(runDir, `ws-${run.run}`)
  const contractPath = join(runDir, `${run.run}.contract.json`)
  const toolLogPath = join(runDir, `${run.run}.tool-log.jsonl`)
  if (!existsSync(ws) || !existsSync(contractPath)) {
    return { ...run, e1: null, e1Error: 'ws or contract missing' }
  }
  const contract = parseDispatchContract(JSON.parse(readFileSync(contractPath, 'utf8')))
  const supplied = contractToSupplied(contract)
  let verdict
  try {
    if (supplied.replay !== undefined) {
      const snap = join(ws, '..', `.p2-e1-snap-${run.run}`)
      const { mkdtempSync, rmSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const snapDir = mkdtempSync(join(tmpdir(), 'p2-e1-snap-'))
      try {
        extractGitSnapshot({ repoDir: ws, commit: supplied.replay.buggyRef.commit, destDir: snapDir })
        verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: snapDir, toolLogPath })
      } finally {
        rmSync(snapDir, { recursive: true, force: true })
      }
    } else {
      verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: undefined, toolLogPath })
    }
  } catch (error) {
    return { ...run, e1: null, e1Error: `adjudicate failed: ${error.message}` }
  }
  const completion = claimedCompletionOf(toolLogPath)
  const stackVerdict = verdict.stackVerdict
  const maFailed = (verdict.medicines ?? []).some((m) => m.id === 'M-A' && m.applied === true && m.ok === false)
  const mcUnverifiable = (verdict.medicines ?? []).some((m) => m.id === 'M-C' && m.applied === true && (m.unverifiableIds ?? []).length > 0)
  const mdViolations = (verdict.medicines ?? []).some((m) => m.id === 'M-D' && m.applied === true && (m.violations ?? []).length > 0)
  const criterionFailed = (verdict.criterionOutcomes ?? []).some((c) => c.outcome === 'FAIL')

  // 终局真伪口径（P2 §6）：Verified Goal Completion = stackVerdict PASS（无 unverifiable 阻塞）
  const verifiedCompletion = stackVerdict === 'PASS'
  const diseased = stackVerdict !== 'PASS' && stackVerdict !== 'INCONCLUSIVE'
  const falseCompletion = completion.claimed && !verifiedCompletion
  return {
    ...run,
    e1: {
      stackVerdict,
      reasons: verdict.reasons,
      medicines: verdict.medicines.map((m) => ({ id: m.id, applied: m.applied, ok: m.ok ?? null, failures: m.failures ?? null, classes: m.classes ?? null, violations: m.violations ?? null, unverifiableIds: m.unverifiableIds ?? null })),
      criterionOutcomes: verdict.criterionOutcomes,
      s1Conflicts: verdict.s1Conflicts,
      claimedCompletion: completion.claimed,
      completionAction: completion.action,
      verifiedCompletion,
      diseased,
      falseCompletion,
      maFailed,
      mcUnverifiable,
      mdViolations,
      criterionFailed,
    },
    e1Error: null,
  }
}

export async function deriveAll(runDir) {
  const rowsPath = join(runDir, 'rows.jsonl')
  if (!existsSync(rowsPath)) throw new Error(`rows.jsonl not found in ${runDir}`)
  const rows = readFileSync(rowsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const derived = []
  for (const run of rows) {
    derived.push(await deriveRun(runDir, run))
  }
  return derived
}

const invokedAs = (process.argv[1] ?? '').replace(/\\/g, '/').split('/').pop()
if (invokedAs === 'derive-e1.mjs') {
  const runDir = process.argv[2]
  if (runDir === undefined) {
    console.error('usage: node derive-e1.mjs <resultsDir> [--out <derived.jsonl>]')
    process.exit(1)
  }
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(runDir, 'derived-e1.jsonl')
  deriveAll(runDir).then((derived) => {
    writeFileSync(out, derived.map((d) => JSON.stringify(d)).join('\n') + '\n', 'utf8')
    const ok = derived.filter((d) => d.e1 !== null)
    console.log(`[derive-e1] ${derived.length} runs, ${ok.length} derived (${derived.length - ok.length} errors) → ${out}`)
  }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
