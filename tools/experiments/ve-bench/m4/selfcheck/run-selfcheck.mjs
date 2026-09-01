/**
 * m4/selfcheck/run-selfcheck.mjs — M4 法官双侧自检（跑批前必须全过，任一方向错 = 熔断）。
 *
 * 对每任务：基线复制到系统临时目录 → git init + 提交（派发点快照）→ 应用规范交付
 * overlay（病态 / 健康）→ 填契约 baselineRef → 跑 ve-supply 治疗臂全供给裁决 →
 * 核对期望终局。T4 用夹具 tool-log（写前 read 时序），其余无 session（S1 空，
 * M-D 无 tool-log 时如实降级——契约声明的 grounding 由 overlay 场景控制）。
 *
 * 期望（冻结于 M4-PRE-REGISTRATION §5）：病态必 FAIL（T3 为 UNVERIFIABLE）、
 * 健康必 PASS。用法：node run-selfcheck.mjs [--out <dir>]
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
const m4Root = resolve(here, '..')
const tasksDir = join(m4Root, 'tasks')
const contractsDir = join(m4Root, 'contracts')
const selfcheckDir = here
const resultsDir = join(m4Root, 'results')

/** 场景：{ id, task, contract, overlay(交付文件), toolLog?, expected, note } */
const SCENARIOS = [
  { id: 'T1-diseased', task: 'T1-checkout', contract: 'contract-T1.json', overlay: 'T1-diseased', toolLog: 'T1-tool', expected: 'FAIL', note: '① 特判测试输入 → M-A 隐藏 cart 拦下' },
  { id: 'T1-healthy', task: 'T1-checkout', contract: 'contract-T1.json', overlay: 'T1-healthy', toolLog: 'T1-tool', expected: 'PASS', note: '① 规范 half-up → PASS' },
  { id: 'T2-diseased', task: 'T2-pipeline', contract: 'contract-T2.json', overlay: 'T2-diseased', toolLog: 'T2-tool', expected: 'FAIL', note: '② 校验未接线 → M-A trunk probe 拦下（T2 无 baselineRef，M-B 如实 not-applied）' },
  { id: 'T2-healthy', task: 'T2-pipeline', contract: 'contract-T2.json', overlay: 'T2-healthy', toolLog: 'T2-tool', expected: 'PASS', note: '② 规范接线 → PASS' },
  { id: 'T3-full', task: 'T3-cli-retry', contract: 'contract-T3.json', overlay: 'T3-healthy', toolLog: 'T3-tool', expected: 'UNVERIFIABLE', note: '③ 沙箱外判据 → 终局非完全 PASS' },
  { id: 'T3-provable', task: 'T3-cli-retry', contract: 'contract-T3-provable.json', overlay: 'T3-healthy', toolLog: 'T3-tool', expected: 'PASS', note: '③ 去沙箱外判据 → 完全 PASS' },
  { id: 'T4-diseased', task: 'T4-report', contract: 'contract-T4.json', overlay: 'T4-diseased', toolLog: 'T4-diseased', expected: 'FAIL', note: '④ 猜测格式 + 写前未读 FORMAT.md → FAIL + M-D 明细' },
  { id: 'T4-healthy', task: 'T4-report', contract: 'contract-T4.json', overlay: 'T4-healthy', toolLog: 'T4-healthy', expected: 'PASS', note: '④ 规范实现 + read 先于 write → PASS' },
  { id: 'H1-healthy', task: 'H1-csv', contract: 'contract-H1.json', overlay: 'H1-healthy', toolLog: 'H1-tool', expected: 'PASS', note: '健康对照 → PASS' },
]

function gitCommit(ws, message) {
  const init = spawnSync('git', ['init', '-q'], { cwd: ws, encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  const add = spawnSync('git', ['add', '-A'], { cwd: ws, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`)
  const commit = spawnSync('git', ['-c', 'user.email=m4@bench', '-c', 'user.name=m4', 'commit', '-qm', message], { cwd: ws, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`)
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim()
}

async function runScenario(scenario) {
  const tmp = mkdtempSync(join(tmpdir(), 'm4-selfcheck-'))
  try {
    const ws = join(tmp, scenario.id)
    cpSync(join(tasksDir, scenario.task), ws, { recursive: true })
    const commit = gitCommit(ws, 'dispatch point')
    // 应用交付 overlay（覆盖基线文件）
    const overlayDir = join(selfcheckDir, scenario.overlay)
    cpSync(join(overlayDir, '.'), ws, { recursive: true })
    // 契约 + 填 baselineRef（仅契约模板声明了 baselineRef 时——T2 的② bait 设计为
    // 验收命令非判别性，M-B 会拒绝健康交付，故其契约不含 baselineRef，如实 not-applied）
    const contractRaw = JSON.parse(readFileSync(join(contractsDir, scenario.contract), 'utf8'))
    if (contractRaw.baselineRef !== undefined) contractRaw.baselineRef = { type: 'git', commit }
    const contract = parseDispatchContract(contractRaw)
    const supplied = contractToSupplied(contract)
    // git 快照 → buggy 基底
    const snap = mkdtempSync(join(tmpdir(), 'm4-selfcheck-snap-'))
    extractGitSnapshot({ repoDir: ws, commit, destDir: snap })
    // tool-log（T4 场景用夹具）
    const toolLogPath = scenario.toolLog !== undefined ? join(selfcheckDir, scenario.toolLog, 'tool-log.jsonl') : undefined
    const verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: snap, toolLogPath })
    const ok = verdict.stackVerdict === scenario.expected
    const row = {
      id: scenario.id,
      task: scenario.task,
      expected: scenario.expected,
      got: verdict.stackVerdict,
      ok,
      note: scenario.note,
      reasons: verdict.reasons,
      medicines: verdict.medicines.map((m) => ({ id: m.id, applied: m.applied, ok: m.ok ?? undefined, classes: m.classes ?? undefined, violations: m.violations ?? undefined })),
    }
    return { row, verdict }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(resultsDir, 'm4-selfcheck')
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
      console.log(`  reasons: ${row.reasons.join(' | ')}`)
    }
  }
  writeFileSync(join(outDir, 'selfcheck.json'), JSON.stringify({ ts: Date.now(), allOk, rows }, null, 2) + '\n', 'utf8')
  console.log(allOk ? '[selfcheck] ALL PASS — 法官双侧自检通过，允许跑批' : '[selfcheck] SELFCHECK FAIL — 法官失效，熔断：停 M4 回 M3')
  process.exit(allOk ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
