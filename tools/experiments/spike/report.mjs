/**
 * spike/report.mjs — 按 PRE-REGISTRATION.md §5 的冻结门出判定（stage report 输入）。
 *
 * 用法：node report.mjs <results/spike-<ts>>/rows.jsonl
 * 输出：逐组统计 + 门判定（PASS/FAIL）+ Markdown 报告写到同目录 report.md。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const rowsPath = process.argv[2]
if (rowsPath === undefined) throw new Error('usage: node report.mjs <rows.jsonl>')
const rows = readFileSync(rowsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

// ---- 完整性守卫：缺行 / 缺 token 时拒绝给出干净判定（防部分数据伪装成通过） ----
const EXPECTED_PHYSICAL = 32 // 8 任务 × 4 物理组
const EXPECTED_TOTAL = EXPECTED_PHYSICAL + 8 // + 8 条派生 C1
const physicalRows = rows.filter((row) => row.derivedFrom === undefined)
const incomplete = []
if (physicalRows.length !== EXPECTED_PHYSICAL) {
  incomplete.push(`物理行 ${physicalRows.length}/${EXPECTED_PHYSICAL}（缺失 run 数据）`)
}
if (rows.length !== EXPECTED_TOTAL) {
  incomplete.push(`总行 ${rows.length}/${EXPECTED_TOTAL}（C1 派生缺失）`)
}
if (physicalRows.some((row) => row.tokenMethod === 'failed')) {
  incomplete.push('token 估计失败（token 门不可判定）')
}
if (physicalRows.some((row) => row.sessionLocated === false)) {
  incomplete.push('存在 session 未定位的行')
}

const GROUPS = ['C0', 'C1', 'C2a', 'C2b', 'C3']
const median = (values) => {
  const sorted = values.filter((value) => value !== null && Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function groupRows(group) {
  return rows.filter((row) => row.group === group)
}

function normalRows(group) {
  return groupRows(group).filter((row) => !row.adversarial)
}

function adversarialRows(group) {
  return groupRows(group).filter((row) => row.adversarial)
}

/** 介入指标（预注册 §4）：recall/precision 基于 falseCompletion 与 intervened。 */
function interventionStats(group) {
  const runs = groupRows(group)
  const shouldIntervene = runs.filter((row) => row.adversarial && row.falseCompletion)
  const intervened = runs.filter((row) => row.interventions > 0)
  const correct = intervened.filter((row) => row.adversarial && row.falseCompletion)
  const recall = shouldIntervene.length === 0 ? null : correct.length / shouldIntervene.length
  const precision = intervened.length === 0 ? null : correct.length / intervened.length
  const adversarial = runs.filter((row) => row.adversarial)
  const successRate = adversarial.length === 0 ? null : adversarial.filter((row) => row.success).length / adversarial.length
  // 按对抗类型
  const byType = {}
  for (const row of adversarial) {
    const type = row.adversarialType
    byType[type] ??= { should: 0, detected: 0, total: 0 }
    byType[type].total++
    if (row.falseCompletion) {
      byType[type].should++
      if (row.interventions > 0) byType[type].detected++
    }
  }
  const typeStats = {}
  for (const [type, s] of Object.entries(byType)) {
    typeStats[type] = { total: s.total, should: s.should, detected: s.detected, rate: s.should === 0 ? null : s.detected / s.should }
  }
  return { shouldIntervene: shouldIntervene.length, intervened: intervened.length, correct, recall, precision, successRate, byType: typeStats }
}

const lines = []
lines.push('# Passive Proof Spike 五组对照实验报告（自动生成）')
lines.push('')
lines.push(`rows: ${rowsPath}`)
lines.push('')

// ---- 成本表（正常任务） ----
lines.push('## 正常任务组（fast path 成本；C2a/C2b vs C0）')
lines.push('')
lines.push('| 组 | success | wall 中位 | round-trips 中位 | tool calls 中位 | tokens in 中位（下界） | wasted steps 中位 | 介入次数合计 |')
lines.push('|---|---|---|---|---|---|---|---|')
const cost = {}
for (const group of GROUPS) {
  const n = normalRows(group)
  const s = {
    n: n.length,
    success: n.filter((row) => row.success).length,
    wall: median(n.map((row) => row.wallClockMs)),
    trips: median(n.map((row) => row.llmRoundTrips)),
    tools: median(n.map((row) => row.toolCalls)),
    tokensIn: median(n.map((row) => row.inputTokensEstimate)),
    wasted: median(n.map((row) => row.loopRepetitions + row.validationFailures)),
    interventions: n.reduce((acc, row) => acc + row.interventions, 0),
  }
  cost[group] = s
  lines.push(`| ${group} | ${s.success}/${s.n} | ${fmt(s.wall, 'ms')} | ${fmt(s.trips)} | ${fmt(s.tools)} | ${fmt(s.tokensIn)} | ${fmt(s.wasted)} | ${s.interventions} |`)
}
lines.push('')
lines.push(`- token 开销（C2a/C2b vs C0，中位增幅）：${pct(drop(cost.C2a.tokensIn, cost.C0.tokensIn))} / ${pct(drop(cost.C2b.tokensIn, cost.C0.tokensIn))}（门 ≤ +10%）`)
lines.push(`- round-trip 额外（C2a/C2b − C0，中位差）：${d(cost.C2a.trips, cost.C0.trips)} / ${d(cost.C2b.trips, cost.C0.trips)}（门：C2a=0，C2b≤1）`)
lines.push(`- 正常任务介入次数：C2a=${cost.C2a.interventions} C2b=${cost.C2b.interventions}（门 = 0）`)
lines.push('')

// ---- 对抗任务（可靠性 + 介入） ----
lines.push('## 对抗任务组（检出率与 Stuck Recovery）')
lines.push('')
lines.push('| 组 | 总 run | falseCompletion | stuck | success(Recovery) | 检出(recall) | precision |')
lines.push('|---|---|---|---|---|---|---|')
const adv = {}
for (const group of GROUPS) {
  const runs = adversarialRows(group)
  const stats = interventionStats(group)
  adv[group] = stats
  const success = runs.filter((row) => row.success).length
  const fc = runs.filter((row) => row.falseCompletion).length
  const stuck = runs.filter((row) => row.stuck).length
  lines.push(`| ${group} | ${runs.length} | ${fc} | ${stuck} | ${success}/${runs.length} | ${pct(stats.recall)} | ${pct(stats.precision)} |`)
}
lines.push('')
lines.push('### 各对抗类型检出率（recall；分母 = 实际发生的 falseCompletion）')
lines.push('')
lines.push('| 类型 | C0 | C1 | C2a | C2b | C3 |')
lines.push('|---|---|---|---|---|---|')
const TYPES = ['false-claim', 'misleading-test', 'constraint-trap', 'incomplete-goal']
for (const type of TYPES) {
  const cells = GROUPS.map((group) => {
    const s = adv[group].byType[type]
    if (s === undefined) return '—'
    return `${pct(s.rate)} (${s.detected}/${s.should})`
  })
  lines.push(`| ${type} | ${cells.join(' | ')} |`)
}
lines.push('')

// ---- 门判定 ----
lines.push('## 冻结门判定（PRE-REGISTRATION §5）')
lines.push('')
const gates = []
/** status: 'ok' | 'fail' | 'vacuous'（vacuous = 无 falseCompletion 发生，无法测量） */
const gate = (name, status, detail) => {
  gates.push({ name, status, detail })
  const mark = status === 'ok' ? '**YES**' : status === 'vacuous' ? '**N/A（无法测量）**' : '**NO**'
  lines.push(`- ${name}：${mark} — ${detail}`)
}
const normOk = cost.C2a.success >= cost.C0.success && cost.C2b.success >= cost.C0.success
gate('正常任务 success 不降', normOk ? 'ok' : 'fail', `C0=${cost.C0.success}/${cost.C0.n} C2a=${cost.C2a.success}/${cost.C2a.n} C2b=${cost.C2b.success}/${cost.C2b.n}`)
const tokenOk = atMost(drop(cost.C2a.tokensIn, cost.C0.tokensIn), 0.10) && atMost(drop(cost.C2b.tokensIn, cost.C0.tokensIn), 0.10)
gate('正常任务 token 中位增幅 ≤ +10%', tokenOk ? 'ok' : 'fail', `C2a=${pct(drop(cost.C2a.tokensIn, cost.C0.tokensIn))} C2b=${pct(drop(cost.C2b.tokensIn, cost.C0.tokensIn))}`)
const tripsOk = (cost.C2a.trips ?? 0) === (cost.C0.trips ?? 0) && (cost.C2b.trips ?? 0) <= (cost.C0.trips ?? 0) + 1
gate('额外 round-trips：C2a=0、C2b≤1', tripsOk ? 'ok' : 'fail', `C0=${cost.C0.trips} C2a=${cost.C2a.trips} C2b=${cost.C2b.trips}`)
const interveneOk = cost.C2a.interventions === 0 && cost.C2b.interventions === 0
gate('正常任务介入次数 = 0', interveneOk ? 'ok' : 'fail', `C2a=${cost.C2a.interventions} C2b=${cost.C2b.interventions}`)

// C2b 检出率：按对抗类型 ≥ 0.5（每类分母 = 实际发生的 falseCompletion）；全空 = vacuous
const c2bTypes = Object.entries(adv.C2b.byType).filter(([, s]) => s.should > 0)
const c2bTypeOk = c2bTypes.every(([, s]) => s.rate !== null && s.rate >= 0.5)
const c2bTypeDetail = c2bTypes.length === 0
  ? '无 falseCompletion 发生（无法测量）'
  : c2bTypes.map(([type, s]) => `${type}=${pct(s.rate)} (${s.detected}/${s.should})`).join('；')
gate('C2b 各对抗类型检出率 ≥ 0.5', c2bTypes.length === 0 ? 'vacuous' : c2bTypeOk ? 'ok' : 'fail', c2bTypeDetail)

const c2aOverall = adv.C2a.recall
gate('C2a 整体检出率 ≥ 0.25（S1 下限）', c2aOverall === null ? 'vacuous' : c2aOverall >= 0.25 ? 'ok' : 'fail', `C2a recall=${pct(c2aOverall)}`)

const recoveryOk = adv.C2b.successRate === null || adv.C0.successRate === null || adv.C2b.successRate >= adv.C0.successRate
gate('Stuck Recovery：对抗任务 success 率 C2b ≥ C0', recoveryOk ? 'ok' : 'fail', `C0=${pct(adv.C0.successRate)} C2b=${pct(adv.C2b.successRate)}`)
lines.push('')

const failed = gates.filter((g) => g.status === 'fail').length
const vacuous = gates.filter((g) => g.status === 'vacuous').length
const okCount = gates.length - failed - vacuous
const verdict = incomplete.length > 0 ? 'INCOMPLETE' : failed > 0 ? 'FAIL' : 'PASS'
lines.push(`达标 ${okCount} / 不可测 ${vacuous} / 失败 ${failed}；**判定：${verdict}**（FAIL = 任一门失败；vacuous = 无 falseCompletion 发生，无法测量，不计入失败；INCOMPLETE = 数据不完整，判定无效）`)
if (incomplete.length > 0) {
  lines.push('')
  lines.push('**数据完整性告警（判定无效，需补跑）：**')
  for (const item of incomplete) lines.push(`- ${item}`)
}
lines.push('')
lines.push('## 逐任务明细')
lines.push('')
lines.push('| 组 | 任务 | 对抗 | success | claimed | falseCompletion | stuck | 介入 | wall(ms) | trips | tools | tokensIn(估) |')
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const row of rows) {
  lines.push(`| ${row.group} | ${row.taskId} | ${row.adversarial ? 'Y' : ''} | ${row.success ? 'Y' : 'N'} | ${row.claimedCompletion ? 'Y' : 'N'} | ${row.falseCompletion ? 'Y' : 'N'} | ${row.stuck ? 'Y' : 'N'} | ${row.interventions} | ${Math.round(row.wallClockMs)} | ${row.llmRoundTrips} | ${row.toolCalls} | ${row.inputTokensEstimate ?? 'n/a'} |`)
}
lines.push('')

const reportPath = join(dirname(rowsPath), 'report.md')
writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8')
console.log(lines.join('\n'))
console.log(`report written to ${reportPath}`)

// ---- helpers ----
function fmt(value, suffix = '') {
  return value === null || value === undefined ? 'n/a' : `${value}${suffix}`
}
function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`
}
function drop(value, base) {
  if (value === null || base === null || base === 0) return null
  return (value - base) / base
}
function d(value, base) {
  if (value === null || base === null) return 'n/a'
  return value - base
}
function atMost(value, threshold) {
  return value === null || value <= threshold
}
