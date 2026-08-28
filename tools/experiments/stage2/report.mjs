/**
 * stage2/report.mjs — 按 PRE-REGISTRATION.md §1 的冻结门出判定（B5/B6 输入）。
 *
 * 用法：node report.mjs <results/stage2-<ts>>/rows.jsonl
 * 输出：逐组统计 + Gungnir vs Code-PTC 门判定（PASS/FAIL）+ Markdown 报告写到同目录 report.md。
 */
import { readFileSync, writeFileSync } from 'node:fs'
// 注：wastedSteps 口径修正（sum → median）为 task-verifier 验收发现的 MINOR 对齐，阈值不变
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const rowsPath = process.argv[2]
if (rowsPath === undefined) throw new Error('usage: node report.mjs <rows.jsonl>')
const rows = readFileSync(rowsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))

const GROUPS = ['standard', 'ptc', 'workflow', 'gungnir']
const median = (values) => {
  const sorted = values.filter(value => value !== null && Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const sum = (values) => values.reduce((acc, value) => acc + value, 0)

const stats = {}
for (const group of GROUPS) {
  const groupRows = rows.filter(row => row.group === group)
  stats[group] = {
    n: groupRows.length,
    successCount: groupRows.filter(row => row.success).length,
    successRate: groupRows.length === 0 ? null : groupRows.filter(row => row.success).length / groupRows.length,
    medianWallMs: median(groupRows.map(row => row.wallClockMs)),
    medianRoundTrips: median(groupRows.map(row => row.llmRoundTrips)),
    medianToolCalls: median(groupRows.map(row => row.toolCalls)),
    medianInputTokens: median(groupRows.map(row => row.inputTokensEstimate)),
    medianOutputTokens: median(groupRows.map(row => row.outputTokensEstimate)),
    // 预注册 §4：组间统计一律中位数（每 run 的 wasted = loopRepetitions + validationFailures）
    wastedSteps: median(groupRows.map(row => row.loopRepetitions + row.validationFailures)),
    instructionViolations: sum(groupRows.map(row => row.instructionViolations)),
    recoveryCount: sum(groupRows.map(row => row.recoveryCount)),
  }
}

function drop(gungnirValue, baseValue) {
  if (gungnirValue === null || baseValue === null || baseValue === 0) return null
  return (baseValue - gungnirValue) / baseValue
}

const gate = {
  successNotDown: stats.gungnir.successRate >= stats.ptc.successRate,
  inputTokensDown: drop(stats.gungnir.medianInputTokens, stats.ptc.medianInputTokens),
  roundTripsDown: drop(stats.gungnir.medianRoundTrips, stats.ptc.medianRoundTrips),
  latencyDown: drop(stats.gungnir.medianWallMs, stats.ptc.medianWallMs),
  wastedStepsDown: drop(stats.gungnir.wastedSteps, stats.ptc.wastedSteps),
}
const criteria = [
  { name: 'input tokens ↓≥20%', value: gate.inputTokensDown, threshold: 0.20 },
  { name: 'LLM round-trips ↓≥25%', value: gate.roundTripsDown, threshold: 0.25 },
  { name: 'latency ↓≥15%', value: gate.latencyDown, threshold: 0.15 },
  { name: '重复无效步骤 ↓≥30%', value: gate.wastedStepsDown, threshold: 0.30 },
]
const passed = criteria.filter(item => item.value !== null && item.value >= item.threshold)
gate.passedCount = passed.length
gate.verdict = gate.successNotDown && passed.length >= 2 ? 'PASS' : 'FAIL'

const fmt = (value, suffix = '') => (value === null ? 'n/a' : `${value}${suffix}`)
const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)

const lines = []
lines.push('# Stage-2 四组对照实验报告（自动生成）')
lines.push('')
lines.push(`rows: ${rowsPath}`)
lines.push('')
lines.push('| 组 | success | wall 中位 | round-trips 中位 | tool calls 中位 | tokens in/out 中位（下界估计） | wasted steps | violations |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const group of GROUPS) {
  const s = stats[group]
  lines.push(`| ${group} | ${s.successCount}/${s.n} | ${fmt(s.medianWallMs, 'ms')} | ${fmt(s.medianRoundTrips)} | ${fmt(s.medianToolCalls)} | ${fmt(s.medianInputTokens)}/${fmt(s.medianOutputTokens)} | ${fmt(s.wastedSteps)} | ${fmt(s.instructionViolations)} |`)
}
lines.push('')
lines.push('## 冻结门判定（Gungnir vs Code-PTC）')
lines.push('')
lines.push(`- task success 不下降：${gate.successNotDown ? 'YES' : 'NO'}（${stats.gungnir.successCount}/${stats.gungnir.n} vs ${stats.ptc.successCount}/${stats.ptc.n}）`)
for (const item of criteria) {
  lines.push(`- ${item.name}：${pct(item.value)}（阈值 ${item.threshold * 100}%）→ ${item.value !== null && item.value >= item.threshold ? '达标' : '未达标'}`)
}
lines.push('')
lines.push(`达标项数：${gate.passedCount}/4；**判定：${gate.verdict}**`)
lines.push('')
lines.push('## 逐任务明细')
lines.push('')
lines.push('| 组 | 任务 | success | wall(ms) | trips | tools | tokensIn(估) | wasted |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const row of rows) {
  lines.push(`| ${row.group} | ${row.taskId} | ${row.success ? 'Y' : 'N'} | ${Math.round(row.wallClockMs)} | ${row.llmRoundTrips} | ${row.toolCalls} | ${row.inputTokensEstimate ?? 'n/a'} | ${row.loopRepetitions + row.validationFailures} |`)
}
lines.push('')

const reportPath = join(dirname(rowsPath), 'report.md')
writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8')
console.log(lines.join('\n'))
console.log(`report written to ${reportPath}`)
