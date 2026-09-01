/**
 * ve-supply/run-supply.mjs — 供给闭环主入口（B2，ADR-0020 / 执行基准 §3）。
 *
 * 输入 = 契约 JSON + 交付工作区 +（可选）session log 路径；流程 =
 * 投影 supplied（contractToSupplied）→ 跑治疗臂 adjudicate + medicines 执行面 →
 * 输出裁决 + 证据链 + 供给覆盖报告（哪些药方有供给、哪些没有、为什么）。
 *
 * 用法：node run-supply.mjs --contract <contract.json> --workspace <交付目录>
 *        [--session <session-log|session-dir|workspace>] [--tool-log <已提取tool-log>]
 *        [--out <结果目录>] [--label <场景名>]
 *
 * 纪律：契约缺字段 / git 快照提取失败 → loud fail（硬异常）；baselineRef 缺省 →
 * M-B 不启用并记入覆盖报告（不假装 replay）；tool-log 缺省但契约声明 grounding →
 * M-D 如实记 violations（tool-log not provided）→ 裁决不伪造。--tool-log 为夹具
 * tool-log 降级通道（计划 §6：M-D 演示降级为夹具 tool-log 并如实随档）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  contractToSupplied,
  parseDispatchContract,
  supplyCoverageOf,
} from '../../packages/core/dist/contract.js'
import { adjudicate } from './adjudicate.mjs'
import { extractGitSnapshot } from './snapshot.mjs'
import { decodeSessionLog, locateSessionLog, sessionToToolEvents, writeToolLog } from './toollog.mjs'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)))
const defaultResultsDir = join(root, 'results')

function parseArgs(argv) {
  const args = { out: null, label: 'run' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--contract') args.contract = argv[++i]
    else if (arg === '--workspace') args.workspace = argv[++i]
    else if (arg === '--session') args.session = argv[++i]
    else if (arg === '--tool-log') args.toolLog = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--label') args.label = argv[++i]
    else throw new Error(`unknown flag: ${arg}`)
  }
  if (args.contract === undefined || args.workspace === undefined) {
    throw new Error('usage: node run-supply.mjs --contract <contract.json> --workspace <dir> [--session <path>] [--out <dir>] [--label <name>]')
  }
  if (!existsSync(args.contract)) throw new Error(`contract not found: ${args.contract}`)
  if (!existsSync(args.workspace)) throw new Error(`workspace not found: ${args.workspace}`)
  return args
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function renderReport({ contract, coverage, supplied, verdict }) {
  const lines = []
  lines.push(`# 供给裁决报告 — ${contract.taskId ?? 'untitled'}`)
  lines.push('')
  lines.push(`- objective: ${contract.objective}`)
  lines.push(`- stackVerdict: **${verdict.stackVerdict}**`)
  lines.push(`- session: ${verdict.sessionId ?? 'not provided'}`)
  lines.push('')
  lines.push('## 供给覆盖报告（SupplyCoverage）')
  lines.push('')
  lines.push('| 药方 | 状态 | 原因 |')
  lines.push('|---|---|---|')
  for (const entry of coverage) {
    lines.push(`| ${entry.medicine} | ${entry.status} | ${entry.reason ?? '—'} |`)
  }
  lines.push('')
  lines.push('## 判据裁决')
  lines.push('')
  for (const outcome of verdict.criterionOutcomes) {
    lines.push(`- criterion ${outcome.id} (${outcome.kind}): ${outcome.outcome} — ${outcome.detailRef}`)
  }
  lines.push('')
  lines.push('## 证据链（reasons）')
  lines.push('')
  if (verdict.reasons.length === 0) lines.push('（无冲突证据）')
  for (const reason of verdict.reasons) lines.push(`- ${reason}`)
  lines.push('')
  lines.push('## 药方执行明细')
  lines.push('')
  for (const medicine of verdict.medicines) {
    const detail = JSON.stringify(medicine)
    lines.push(`- ${medicine.id}: applied=${medicine.applied}${detail.length > 300 ? '' : ` ${detail}`}`)
  }
  lines.push('')
  lines.push('## 投影 supplied（概览）')
  lines.push('')
  lines.push(`- criteria: ${supplied.criteria.length} 条控制臂判据`)
  lines.push(`- api: ${supplied.api?.template ?? '未供给（M-A not-applied）'}`)
  lines.push(`- replay: ${supplied.replay ? `${supplied.replay.evidence.length} 条声称证据，buggyRef=${supplied.replay.buggyRef.commit}` : '未供给（M-B not-applied）'}`)
  lines.push(`- unverifiableCriteria: ${supplied.unverifiableCriteria?.length ?? 0} 条`)
  lines.push(`- grounding: ${supplied.grounding ? `${supplied.grounding.dependencies.length} 条依赖声明` : '未供给（M-D not-applied）'}`)
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const contract = parseDispatchContract(JSON.parse(readFileSync(args.contract, 'utf8')))
  const supplied = contractToSupplied(contract)
  const coverage = supplyCoverageOf(contract)

  const outDir = args.out ?? join(defaultResultsDir, `${stamp()}-${args.label}`)
  mkdirSync(outDir, { recursive: true })

  // M-B：git 快照提取（无 baselineRef → 不启用，覆盖报告已如实记录）
  let buggyBaseDir
  if (supplied.replay !== undefined) {
    const tmp = mkdtempSync(join(tmpdir(), 've-supply-snap-'))
    extractGitSnapshot({ repoDir: args.workspace, commit: supplied.replay.buggyRef.commit, destDir: tmp })
    buggyBaseDir = tmp
    cpSync(buggyBaseDir, join(outDir, 'buggy-baseline'), { recursive: true })
  }

  // M-D / S1：session log → tool-log（--tool-log 为已提取的夹具/降级通道）
  let toolLogPath
  let sessionId = null
  if (args.toolLog !== undefined && args.toolLog !== '') {
    if (!existsSync(args.toolLog)) throw new Error(`run-supply: tool-log not found: ${args.toolLog}`)
    toolLogPath = join(outDir, 'tool-log.jsonl')
    cpSync(args.toolLog, toolLogPath)
    sessionId = null
  } else if (args.session !== undefined && args.session !== '') {
    const located = locateSessionLog(args.session, args.workspace)
    if (located === null) throw new Error(`run-supply: session log not found for --session ${args.session}`)
    sessionId = located.sessionId
    const events = decodeSessionLog(located.logPath)
    const toolEvents = sessionToToolEvents(events, args.workspace)
    toolLogPath = join(outDir, 'tool-log.jsonl')
    writeToolLog(toolEvents, toolLogPath)
  }

  const verdict = await adjudicate({ workspace: args.workspace, supplied, buggyBaseDir, toolLogPath })
  const full = {
    contract,
    coverage,
    suppliedOverview: {
      criteriaCount: supplied.criteria.length,
      apiTemplate: supplied.api?.template ?? null,
      replayEvidenceCount: supplied.replay?.evidence.length ?? 0,
      buggyRefCommit: supplied.replay?.buggyRef.commit ?? null,
      unverifiableCriteriaCount: supplied.unverifiableCriteria?.length ?? 0,
      groundingDependenciesCount: supplied.grounding?.dependencies.length ?? 0,
    },
    verdict: { ...verdict, sessionId },
    meta: {
      runAt: new Date().toISOString(),
      workspace: args.workspace,
      contractPath: args.contract,
      outDir,
    },
  }
  writeFileSync(join(outDir, 'verdict.json'), JSON.stringify(full, null, 2) + '\n', 'utf8')
  writeFileSync(join(outDir, 'report.md'), renderReport({ contract, coverage, supplied, verdict: full.verdict }), 'utf8')
  writeFileSync(join(outDir, 'contract.frozen.json'), JSON.stringify(contract, null, 2) + '\n', 'utf8')
  if (args.session !== undefined && args.session !== '') {
    // 留档 session 定位信息（不复制大文件）
    writeFileSync(join(outDir, 'session-ref.json'), JSON.stringify({ sessionId, provided: args.session }, null, 2) + '\n', 'utf8')
  }

  console.log(`[ve-supply] ${args.label}: stackVerdict=${verdict.stackVerdict}`)
  console.log(`[ve-supply] coverage: ${coverage.map((entry) => `${entry.medicine}=${entry.status}`).join(' ')}`)
  for (const reason of verdict.reasons) console.log(`  - ${reason}`)
  console.log(`[ve-supply] results in ${outDir}`)
  return full
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
