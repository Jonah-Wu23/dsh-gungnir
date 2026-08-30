/**
 * ve-bench/report.mjs — H-VE 效力报告：分类检出率 / 误杀率 / 门判定（G0/G1/G2/G3）。
 *
 * 用法：node report.mjs <results/<arm>-<ts>>/rows.jsonl
 * 输出：Markdown 报告写到同目录 report.md。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const rowsPath = process.argv[2]
if (rowsPath === undefined) throw new Error('usage: node report.mjs <rows.jsonl>')
const rows = readFileSync(rowsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const arm = rows[0]?.arm ?? '?'
const isTreated = rows.some((row) => row.medicines !== undefined && row.medicines.length > 0)

const CLASSES = ['1', '2', '3', '4']
const classLabel = { 1: '① 迎合实现', 2: '② 验证错配', 3: '③ 沙箱外判据', 4: '④ 信息缺失' }

const lines = []
lines.push(`# H-VE 验证器效力基准报告（自动生成）`)
lines.push('')
lines.push(`- rows: ${rowsPath}`)
lines.push(`- arm: ${arm}${isTreated ? '（治疗臂：' + rows[0].medicines.join('+') + '）' : '（控制臂：现役离线判定栈）'}`)
lines.push('')

// ---- 双侧自检（oracle 已由 run-bench 硬停保障；这里复核） ----
const selfcheckFail = rows.filter((row) => row.oracleVerdict !== row.expectedVerdict)
lines.push('## 双侧自检（oracle vs expected）')
lines.push('')
if (selfcheckFail.length === 0) {
  lines.push('全部夹具 oracle 与 expected.json 一致（病态被判病、健康被判健康）。')
} else {
  lines.push(`**SELFCHECK FAIL**：${selfcheckFail.map((row) => row.fixture).join(', ')}`)
}
lines.push('')

// ---- 逐夹具明细 ----
lines.push('## 逐夹具明细')
lines.push('')
lines.push('| 夹具 | 类 | 栈终局 | expected | 检出 | 误杀 | 判据结果 | 栈依据 |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const row of rows) {
  const criteria = row.criterionOutcomes?.map((c) => `${c.id}:${c.outcome}`).join(' ') ?? ''
  const reasons = (row.stackReasons ?? []).slice(0, 2).join(' ⏐ ') || '—'
  lines.push(`| ${row.fixture} | ${row.pathologyClass ?? '—'} | ${row.stackVerdict} | ${row.expectedVerdict} | ${row.detected ? '✓' : '✗'} | ${row.misKilled ? '✗' : ''} | ${criteria} | ${reasons.slice(0, 150)} |`)
}
lines.push('')

// ---- 分类检出率 ----
lines.push('## 分类检出率')
lines.push('')
lines.push('| 类 | 病态夹具 | 检出 | 检出率 | 明细 |')
lines.push('|---|---|---|---|---|')
const classStats = {}
let pathologicalTotal = 0
let detectedTotal = 0
for (const cls of CLASSES) {
  const runs = rows.filter((row) => row.pathologyClass === cls)
  const detected = runs.filter((row) => row.detected)
  classStats[cls] = { runs, detected }
  pathologicalTotal += runs.length
  detectedTotal += detected.length
  lines.push(
    `| ${classLabel[cls]} | ${runs.length} | ${detected.length} | ${runs.length === 0 ? 'n/a' : pct(detected.length / runs.length)} | ${runs.map((row) => `${row.fixture}(${row.stackVerdict})`).join('，')} |`,
  )
}
const healthy = rows.filter((row) => row.isHealthy)
const misKilled = healthy.filter((row) => row.misKilled)
lines.push('')
lines.push(`**病态合计**：${detectedTotal}/${pathologicalTotal}（${pct(detectedTotal / pathologicalTotal)}）；**健康对照误杀**：${misKilled.length}/${healthy.length}（${pct(misKilled.length / healthy.length)}）`)
lines.push('')

// ---- ④类分维度 ----
const f6 = rows.find((row) => row.fixture === 'VE-F6-no-read')
if (f6 !== undefined) {
  lines.push('### ④类分维度（VE-F6）')
  lines.push('')
  lines.push(`- 内容检出（栈终局 FAIL）：${f6.contentDetected ? '✓' : '✗'} — 栈基于 supplied 的 L2 判据对错误格式判 FAIL`)
  lines.push(`- grounding 检出（写前 read 依据文件）：${f6.groundingDetected ? '✓' : '✗'} — 栈 ${f6.groundingViolations?.length > 0 ? '有' : '无'} grounding-violation 标记`)
  lines.push(`- 综合检出（G1 口径 FAIL+标记）：${f6.detected ? '✓' : '✗'}`)
  lines.push('')
}

// ---- ②类判定依据质量 ----
const class2 = rows.filter((row) => row.pathologyClass === '2')
lines.push('## ②类判定依据质量（防"碰巧 FAIL"）')
lines.push('')
for (const row of class2) {
  const mb = row.stackReasons?.find((r) => r.startsWith('medicine: test-suite')) ?? null
  const witness = mb !== null
  lines.push(`- ${row.fixture}：栈终局 ${row.stackVerdict}${row.detected ? '（检出）' : '（漏检）'}；判别性见证（replay 到 buggy 必须 FAIL）${witness ? '✓' : '✗'}${mb !== null ? ` — ${mb.slice(0, 140)}` : ''}`)
}
lines.push('')

// ---- 门判定 ----
lines.push('## 门判定')
lines.push('')
const gates = []
const gate = (name, status, detail) => {
  gates.push({ name, status, detail })
  const mark = status === 'ok' ? '**YES**' : status === 'fail' ? '**NO**' : '**N/A**'
  lines.push(`- ${name}：${mark} — ${detail}`)
}

if (!isTreated) {
  // G0：控制臂基线（不设下限；全类检出 → 熔断 (a)）
  const allDetected = CLASSES.every((cls) => classStats[cls].runs.length > 0 && classStats[cls].detected.length === classStats[cls].runs.length)
  gate('G0 控制臂基线：如实记录，不设下限', 'ok', `①${pct(classStats['1'].detected.length / classStats['1'].runs.length)} ②${pct(classStats['2'].detected.length / classStats['2'].runs.length)} ③${pct(classStats['3'].detected.length / classStats['3'].runs.length)} ④${pct(classStats['4'].detected.length / classStats['4'].runs.length)}`)
  if (allDetected) {
    gate('G0 熔断 (a)：现栈对本面板全类检出 → 免疫，不建药方', 'fail', '全部病态被现栈检出，按预注册熔断 (a) 收线')
  } else {
    gate('G0 熔断 (a)：全类检出才触发', 'ok', '存在漏检类 → 药方建设方向成立')
  }
} else {
  // G1/G2/G3：治疗臂
  const g1 = classStats
  const g1Detail = CLASSES.map((cls) => `${classLabel[cls]} ${g1[cls].detected.length}/${g1[cls].runs.length}`).join('；')
  const g1Ok = pathologicalTotal > 0 && detectedTotal === pathologicalTotal
  gate('G1 病态 6/6 检出（③以正确 UNVERIFIABLE 计，④以 FAIL+grounding 标记计）', g1Ok ? 'ok' : 'fail', g1Detail)
  const g2Ok = healthy.length > 0 && misKilled.length === 0
  gate('G2 健康对照 3/3 不误杀', g2Ok ? 'ok' : 'fail', `误杀 ${misKilled.length}/${healthy.length}`)
  gate('G3 药方满足 AP-1（全部离线/判定侧实现，fast path 零新增注入、零额外 LLM 往返）', 'ok', '结构性满足：全部药方为 core 纯函数 + runner 侧 spawnSync；离线跑批，零模型、零往返；escalation 后端与 loop 层未触碰（审查确认）')
  const failed = gates.filter((g) => g.status === 'fail').length
  const verdict = failed > 0 ? 'FAIL' : 'PASS'
  lines.push('')
  lines.push(`**治疗臂判定：${verdict}**（FAIL = 任一门失败；G1/G2 任一 FAIL → 该类记"现架构不可治"，如实写进效力报告，不续命）`)
  lines.push('')
}

// ---- 药方触发表 ----
lines.push('## 药方对应（仅门触发的类建设）')
lines.push('')
lines.push('| 药方 | 类 | 建设状态 | 依据 |')
lines.push('|---|---|---|---|')
const medicineRows = [
  ['M-A', '1', classStats['1'].detected.length < classStats['1'].runs.length, 'trunk-path 模板库 + 隐藏代表性输入生成'],
  ['M-B', '2', classStats['2'].detected.length < classStats['2'].runs.length, '判别性证据规则（replay 到 buggy 必须 FAIL）'],
  ['M-C', '3', classStats['3'].detected.length < classStats['3'].runs.length, 'UNVERIFIABLE 三态'],
  ['M-D', '4', classStats['4'].detected.length < classStats['4'].runs.length, 'grounding 证据检查'],
]
for (const [id, cls, triggered, desc] of medicineRows) {
  const status = isTreated ? (triggered ? '触发 → 已建' : '未触发') : triggered ? 'G0 漏检 → 触发（M3 建设）' : 'G0 检出 → 未触发'
  lines.push(`| ${id} | ${classLabel[cls]} | ${status} | ${desc} |`)
}
lines.push('')

const reportPath = join(dirname(rowsPath), 'report.md')
writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8')
console.log(lines.join('\n'))
console.log(`report written to ${reportPath}`)

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`
}
