/**
 * repair-rows.mjs — Stage 行修复工具（工程事故后的数据修复，修复动作全部留痕）。
 *
 * 背景（Day 5 实施期发现的两个缺陷，见 BENCHMARK.md §7 事故 #6）：
 * 1. branch-search-strategy 的分支报告 follow-up 引用了被误删的 REPORT_REQUEST 导入
 *    → A 架构在该路径上 ReferenceError 崩溃；崩溃行（runError 非空）不是架构行为的
 *    有效样本，必须从 rows.jsonl 剔除并重跑（stage1.mjs 的 resume 机制）。
 * 2. metrics.computeBehaviorMetrics 把 strategy 子会话的 driver-run-end 计入了
 *    claimedCompletion（完成声明被污染）→ 所有 A/B 行的 metrics 必须用修复后的
 *    summarizeRun 从事件流重算（事件流未受损，无需重烧 run）。
 *
 * 用法：node src/repair-rows.mjs <stageDir>
 */
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TASKS } from './tasks.mjs'
import { summarizeRun } from './metrics.mjs'
import { decodeSessionLog, locateSessionLog, summarizeBaselineSession } from './baseline-log.mjs'
import { scoreTests } from './metrics.mjs'

const stageDir = process.argv[2]
if (stageDir === undefined) {
  console.error('usage: node src/repair-rows.mjs <stageDir>')
  process.exit(2)
}
const rowsPath = join(stageDir, 'rows.jsonl')
const rows = readFileSync(rowsPath, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
copyFileSync(rowsPath, join(stageDir, 'rows.jsonl.pre-repair'))

const repaired = []
const dropped = []
for (const row of rows) {
  if (row.runError !== null && row.runError !== undefined) {
    dropped.push({ taskId: row.taskId, architecture: row.architecture, reason: row.runError.slice(0, 120) })
    continue // 崩溃行：剔除，交回 stage1 resume 重跑
  }
  if (row.architecture === 'baseline') {
    // baseline 行的 claimedCompletion 口径本就独立（session turn/end），不重算
    repaired.push(row)
    continue
  }
  const eventsPath = join(stageDir, `events-${row.architecture}-${row.taskId}.jsonl`)
  const events = readFileSync(eventsPath, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
  const task = TASKS.find((entry) => entry.id === row.taskId)
  const metrics = summarizeRun(events, { startedAtMs: Date.parse(row.startedAt), endedAtMs: Date.parse(row.startedAt) + row.elapsedMs }, task.tests)
  repaired.push({
    ...row,
    metrics,
    falseCompletion: metrics.claimedCompletion && row.vgcrPass !== true,
  })
}

writeFileSync(rowsPath, repaired.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
console.log(`rows: ${rows.length} -> ${repaired.length} (dropped ${dropped.length} for re-run)`)
for (const entry of dropped) console.log(`  dropped: ${entry.taskId} ${entry.architecture}: ${entry.reason}`)
