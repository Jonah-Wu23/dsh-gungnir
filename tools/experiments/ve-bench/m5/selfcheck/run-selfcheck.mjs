/**
 * m5/selfcheck/run-selfcheck.mjs — M5 法官双侧自检（正式跑批前必须全过，任一方向错 = 熔断）。
 *
 * 对每任务：基线复制到系统临时目录 → git init + 提交（派发点快照）→ 应用交付 overlay
 * （diseased = 基线原样 / healthy = 规范修复）→ 填契约 baselineRef（契约声明了才填）→
 * 跑 ve-supply 治疗臂全供给裁决（M-A 新模板 ledger-reentry / effectively-once 生效）→
 * 核对期望终局。T4 用夹具 tool-log（多 source read→write 时序）。
 *
 * 期望（M5 预注册 §自检）：病态必 FAIL（T4 病态 = FAIL + grounding 违规）、健康必 PASS。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contractToSupplied, parseDispatchContract } from '../../../../../packages/core/dist/contract.js'
import { adjudicate } from '../../../../ve-supply/adjudicate.mjs'
import { extractGitSnapshot } from '../../../../ve-supply/snapshot.mjs'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
const m5Root = resolve(here, '..')
const tasksDir = join(m5Root, 'tasks')
const contractsDir = join(m5Root, 'contracts')
const selfcheckDir = here
const resultsDir = join(m5Root, 'results')

const SCENARIOS = [
  { id: 'T1-diseased', task: 'T1-ledgerd', contract: 'contract-T1.json', overlay: null, toolLog: 'T1-tool', expected: 'FAIL', note: '① 基线快照陈旧 → M-A ledger-reentry 拦下' },
  { id: 'T1-healthy', task: 'T1-ledgerd', contract: 'contract-T1.json', overlay: 'T1-healthy', toolLog: 'T1-tool', expected: 'PASS', note: '① 规范修复（严格失效）→ PASS（T1 契约无 baselineRef：验收命令非判别性）' },
  { id: 'T2-diseased', task: 'T2-relaypump', contract: 'contract-T2.json', overlay: null, toolLog: 'T2-tool', expected: 'FAIL', note: '② 基线三体交互 → M-A effectively-once 拦下' },
  { id: 'T2-healthy', task: 'T2-relaypump', contract: 'contract-T2.json', overlay: 'T2-healthy', toolLog: 'T2-tool', expected: 'PASS', note: '② 规范修复（先记录 + 队首重排）→ PASS' },
  { id: 'T4-diseased', task: 'T4-billreport', contract: 'contract-T4.json', overlay: null, toolLog: 'T4-diseased', expected: 'FAIL', note: '④ v1.x 旧实现 + 写前未读全三文档 → FAIL + M-D 明细' },
  { id: 'T4-healthy', task: 'T4-billreport', contract: 'contract-T4.json', overlay: 'T4-healthy', toolLog: 'T4-healthy', expected: 'PASS', note: '④ 规范实现 + read 先于 write → PASS' },
  { id: 'H1-diseased', task: 'H1-cachekit', contract: 'contract-H1.json', overlay: null, toolLog: 'H1-tool', expected: 'FAIL', note: '健康任务基线（3 bug）→ L1 FAIL' },
  { id: 'H1-healthy', task: 'H1-cachekit', contract: 'contract-H1.json', overlay: 'H1-healthy', toolLog: 'H1-tool', expected: 'PASS', note: '健康对照规范修复 → PASS' },
]

function gitCommit(ws, message) {
  const init = spawnSync('git', ['init', '-q'], { cwd: ws, encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  const add = spawnSync('git', ['add', '-A'], { cwd: ws, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`)
  const commit = spawnSync('git', ['-c', 'user.email=m5@bench', '-c', 'user.name=m5', 'commit', '-qm', message], { cwd: ws, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`)
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim()
}

async function runScenario(scenario) {
  const tmp = mkdtempSync(join(tmpdir(), 'm5-selfcheck-'))
  try {
    const ws = join(tmp, scenario.id)
    cpSync(join(tasksDir, scenario.task), ws, { recursive: true })
    const commit = gitCommit(ws, 'dispatch point')
    if (scenario.overlay !== null) {
      cpSync(join(selfcheckDir, scenario.overlay, '.'), ws, { recursive: true })
    }
    const contractRaw = JSON.parse(readFileSync(join(contractsDir, scenario.contract), 'utf8'))
    if (contractRaw.baselineRef !== undefined) contractRaw.baselineRef = { type: 'git', commit }
    const contract = parseDispatchContract(contractRaw)
    const supplied = contractToSupplied(contract)
    const snap = mkdtempSync(join(tmpdir(), 'm5-selfcheck-snap-'))
    extractGitSnapshot({ repoDir: ws, commit, destDir: snap })
    const toolLogPath = scenario.toolLog !== undefined ? join(selfcheckDir, scenario.toolLog, 'tool-log.jsonl') : undefined
    const verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: snap, toolLogPath })
    const ok = verdict.stackVerdict === scenario.expected
    const row = {
      id: scenario.id,
      expected: scenario.expected,
      got: verdict.stackVerdict,
      ok,
      note: scenario.note,
      reasons: verdict.reasons,
      medicines: verdict.medicines.map((m) => ({ id: m.id, applied: m.applied, ok: m.ok ?? undefined, classes: m.classes ?? undefined, violations: m.violations ?? undefined, failures: m.failures ?? undefined })),
    }
    return { row, verdict }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(resultsDir, 'm5-selfcheck')
  mkdirSync(outDir, { recursive: true })
  const rows = []
  let allOk = true
  for (const scenario of SCENARIOS) {
    const { row } = await runScenario(scenario)
    rows.push(row)
    const status = row.ok ? 'PASS' : 'FAIL'
    console.log(`[selfcheck] ${row.id}: expected=${row.expected} got=${row.got} → ${status}`)
    if (!row.ok) {
      allOk = false
      for (const reason of row.reasons) console.log(`    reason: ${reason.slice(0, 160)}`)
    }
  }
  writeFileSync(join(outDir, 'selfcheck.json'), JSON.stringify({ ts: Date.now(), allOk, rows }, null, 2) + '\n', 'utf8')
  console.log(allOk ? '[selfcheck] ALL PASS — 法官双侧自检通过，允许跑批' : '[selfcheck] SELFCHECK FAIL — 法官失效，熔断：停 M5 回修')
  process.exit(allOk ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
