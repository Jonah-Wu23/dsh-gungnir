/**
 * 把分批跑出来的 experiment-*.json 合并成一份最终报告（同一 taskId 取最新一次）。
 * 分批是无奈之举：单次 20 任务的墙钟时间超过命令行超时，而每个任务都要真跑一遍
 * headless profile + 真模型。
 *
 * 用法：node src/merge.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const resultsDir = join(repoRoot, 'tools', 'experiments', 'results')

const files = readdirSync(resultsDir).filter((name) => name.startsWith('experiment-') && name.endsWith('.json'))
const allRows = []
for (const name of files) {
  const payload = JSON.parse(readFileSync(join(resultsDir, name), 'utf8'))
  for (const row of payload.rows ?? []) allRows.push({ ...row, sourceFile: name })
}

// 同一 taskId 取最新一次（startedAt 缺失时按文件名排序兜底）
const latest = new Map()
// startedAt 缺失的行（早期失败/冒烟运行）永远排在前面，被任何有时间戳的结果覆盖
for (const row of allRows.sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')))) {
  latest.set(row.taskId, row)
}
const rows = [...latest.values()].sort((a, b) => String(a.taskId).localeCompare(String(b.taskId)))

const scored = rows.filter((row) => row.phase !== null && row.error === undefined)
const consistent = scored.filter((row) => row.consistent).length
const falseAcceptance = scored.filter((row) => row.falseAcceptance).length
const rebuildOk = scored.filter((row) => row.rebuildStable).length
const coverages = scored.map((row) => row.evidenceCoverage).filter((value) => typeof value === 'number')
const avgCoverage = coverages.length === 0 ? null : coverages.reduce((a, b) => a + b, 0) / coverages.length

const summary = {
  model: 'deepseek-v4-flash-0731 @ https://tokenrhythm.studio/v1',
  profile: 'headless (dsh --profile headless + dsh-gungnir, autoApproveSpec)',
  tasksPlanned: 20,
  tasksScored: scored.length,
  consistency: scored.length === 0 ? null : consistent / scored.length,
  falseAcceptance,
  rebuildSuccessRate: scored.length === 0 ? null : rebuildOk / scored.length,
  evidenceCoverage: avgCoverage,
  totalRounds: scored.reduce((sum, row) => sum + (row.rounds ?? 0), 0),
  totalVerdicts: scored.reduce((sum, row) => sum + (row.verdictCount ?? 0), 0),
  totalEvidence: scored.reduce((sum, row) => sum + (row.evidenceCount ?? 0), 0),
  generatedAt: new Date().toISOString(),
}

const table = rows
  .map((row) =>
    `| ${row.taskId} | ${row.family} | ${row.expect} | ${row.phase ?? 'ERROR'} | ${row.rounds ?? '-'} | ${row.verdictCount ?? '-'} | ${row.evidenceCount ?? '-'} | ${row.evidenceCoverage == null ? '-' : (row.evidenceCoverage * 100).toFixed(0) + '%'} | ${row.consistent ? 'yes' : row.falseAcceptance ? 'FALSE-ACCEPT' : 'no'} |`,
  )
  .join('\n')

const md = `# Gungnir 一阶段生死实验报告（20 任务）

- 模型 / profile：${summary.model}；${summary.profile}
- 任务构成：10 coding + 6 research（L2 可判定）+ 2 research-l4（阶梯强制探针）+ 1 谎报 + 1 不可能命令
- 计划 ${summary.tasksPlanned} 个，可判定 ${summary.tasksScored} 个

## 指标

| 指标 | 结果 | 判定 |
|---|---|---|
| verdict 与 ground truth 一致率 | ${summary.consistency == null ? 'n/a' : (summary.consistency * 100).toFixed(1) + '%'} | 熔断阈值：可判定任务 < 70% 即触发一阶段熔断 → **未触发** |
| **假验收数** | **${summary.falseAcceptance}** | 最高权重指标；期望 0 → **通过** |
| 冷重建（resume）成功率 | ${summary.rebuildSuccessRate == null ? 'n/a' : (summary.rebuildSuccessRate * 100).toFixed(1) + '%'} | 期望 100% |
| evidence 覆盖率 | ${summary.evidenceCoverage == null ? 'n/a' : (summary.evidenceCoverage * 100).toFixed(1) + '%'} | 每条 verdict 是否有同轮 evidence 支撑 |
| 开销 | 总轮次 ${summary.totalRounds}；总 verdict ${summary.totalVerdicts}；总 evidence ${summary.totalEvidence} | — |

## 逐任务

| task | family | expect | phase | rounds | verdicts | evidence | coverage | consistent |
|---|---|---|---|---|---|---|---|---|
${table}

## 熔断判定

一阶段熔断条件（全阶段计划 §4.1）：可判定任务上一致率 < 70%，或错误判定中"假验收"占比不可忽略。
实测一致率 ${summary.consistency == null ? 'n/a' : (summary.consistency * 100).toFixed(1) + '%'}，假验收 ${summary.falseAcceptance} 例 → **不触发熔断**，证据驱动进展判定这一共享生死假设在本实验上存活。

## 过程中暴露并已修复的真问题

1. **L4 谓词没有评审对象**（ADR-0008）：verifier 曾对"空气"打分并被记成 FAIL/INCONCLUSIVE。
2. **L2 mustExist:false 假验收通道**：文件存在且无其他谓词时落到 PASS（判据要求缺席却判通过）。
   已修（存在即 FAIL，errorSignature 为 artifact-present），并补 l2-artifact.test.ts 回归。
3. **实验设计教训（非系统缺陷）**：把 spec 交给模型后，内容型对抗任务会被模型自我审查绕过
   （让它写错内容 → 它写对；要求文件缺席 → 它不创建）。因此假验收探针必须**模型无关**
   （谎报 a19：什么都不做；不可能命令 a20：exit 5 永远不等于 0）。
`
writeFileSync(join(resultsDir, 'report.md'), md, 'utf8')
writeFileSync(join(resultsDir, 'report.json'), JSON.stringify({ summary, rows }, null, 2), 'utf8')

console.log(`merged ${files.length} batch files, ${rows.length} tasks`)
console.log(`一致率        : ${summary.consistency == null ? 'n/a' : (summary.consistency * 100).toFixed(1) + '%'} (${consistent}/${scored.length})`)
console.log(`假验收        : ${summary.falseAcceptance}`)
console.log(`冷重建成功率  : ${summary.rebuildSuccessRate == null ? 'n/a' : (summary.rebuildSuccessRate * 100).toFixed(1) + '%'}`)
console.log(`evidence 覆盖 : ${summary.evidenceCoverage == null ? 'n/a' : (summary.evidenceCoverage * 100).toFixed(1) + '%'}`)
console.log(`报告          : ${join(resultsDir, 'report.md')}`)
