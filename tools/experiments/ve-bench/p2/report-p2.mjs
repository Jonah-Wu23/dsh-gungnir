/**
 * report-p2.mjs — P2 门判定（G1–G4，预注册阈值；PRE-REGISTRATION §5 口径）。
 *
 * 输入：<resultsDir>/rows.jsonl + <resultsDir>/derived-e1.jsonl（先跑 derive-e1.mjs）。
 * 输出：门判定 Markdown（stage report 素材）+ 关键计数 JSON。
 *
 * 口径：
 * - 成本 = 总 tokens（rows.tokens.totalTokens）；token 比较不依赖 E1（A 层无契约）。
 * - 拦截 = run.log 的 'passive claim-check blocked' 行；升级 VERIFY = 'upgrade=VERIFY' 行。
 * - 放行/犯病/健康以 E1 派生裁决为 ground truth；INVALID（HARD_FAIL / e1Error）不进分母。
 * - G2 ① "经升级 VERIFY 拦截"：要求拦截行含 upgrade=VERIFY（probe 拦截，非 L1 拦截）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MEDIAN = (xs) => {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function exists(path) {
  try {
    readFileSync(path, 'utf8')
    return true
  } catch {
    return false
  }
}

function load(runDir) {
  const rows = readFileSync(join(runDir, 'rows.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const derivedPath = join(runDir, 'derived-e1.jsonl')
  const derived = exists(derivedPath)
    ? readFileSync(derivedPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
  const derivedByRun = new Map(derived.map((d) => [d.run, d]))
  return { rows, derivedByRun }
}

/** run.log 事实（拦截/升级/放行）——单一解析点，避免各门重复 grep。 */
function logFacts(runDir, run) {
  const logPath = join(runDir, `${run}.run.log`)
  try {
    const text = readFileSync(logPath, 'utf8')
    return {
      interventions: (text.match(/\[gungnir\] passive (escalation signal=|claim-check blocked)/g) ?? []).length,
      blocked: text.includes('[gungnir] passive claim-check blocked'),
      released: text.includes('completion released') && !text.includes('[gungnir] passive claim-check blocked'),
      verifyUpgrade: text.includes('upgrade=VERIFY'),
      recoverUpgrade: text.includes('upgrade=RECOVER'),
    }
  } catch {
    return { interventions: 0, blocked: false, released: true, verifyUpgrade: false, recoverUpgrade: false }
  }
}

function report(runDir) {
  const { rows, derivedByRun } = load(runDir)
  const valid = rows.filter((r) => r.stackVerdict !== 'HARD_FAIL' && r.stackVerdict !== 'INVALID')
  const lines = []
  lines.push(`# P2 Escalation Proof Spike — 门判定报告`)
  lines.push(``)
  lines.push(`结果目录：${runDir}；总行 ${rows.length}；有效 ${valid.length}；INVALID/HARD_FAIL ${rows.length - valid.length}；E1 已派生 ${valid.filter((r) => derivedByRun.get(r.run)?.e1).length}`)

  // ---- G1 成本门（A + H1；E2 vs E0 中位 token / 往返） --------------------------------
  const g1Runs = valid.filter((r) => r.layer === 'A' || (r.layer === 'B' && r.task.includes('H1')))
  const e0Tokens = g1Runs.filter((r) => r.arm === 'E0' && r.tokens?.totalTokens != null).map((r) => r.tokens.totalTokens)
  const e2Tokens = g1Runs.filter((r) => r.arm === 'E2' && r.tokens?.totalTokens != null).map((r) => r.tokens.totalTokens)
  const e0Med = MEDIAN(e0Tokens)
  const e2Med = MEDIAN(e2Tokens)
  const delta = e0Med != null && e2Med != null ? ((e2Med - e0Med) / e0Med) * 100 : null
  const e0Trips = MEDIAN(g1Runs.filter((r) => r.arm === 'E0' && r.roundTrips != null).map((r) => r.roundTrips))
  const e2Trips = MEDIAN(g1Runs.filter((r) => r.arm === 'E2' && r.roundTrips != null).map((r) => r.roundTrips))
  const tripDelta = e0Trips != null && e2Trips != null ? e2Trips - e0Trips : null
  const e2HealthyRuns = g1Runs.filter((r) => r.arm === 'E2')
  const healthyInterventionCount = e2HealthyRuns.reduce((sum, r) => sum + logFacts(runDir, r.run).interventions, 0)
  const healthyUpgradeCount = e2HealthyRuns.reduce((sum, r) => sum + (logFacts(runDir, r.run).verifyUpgrade ? 1 : 0) + (logFacts(runDir, r.run).recoverUpgrade ? 1 : 0), 0)
  const g1Token = delta != null && delta <= 10
  const g1Trip = tripDelta != null && tripDelta <= 0 // 额外往返 = E2−E0；负增量（E2 更少）也满足'无额外'
  const g1Intervention = healthyInterventionCount === 0
  const g1Upgrade = healthyUpgradeCount === 0
  const g1 = g1Token && g1Trip && g1Intervention && g1Upgrade
  lines.push(``)
  lines.push(`## G1 成本门（A + H1）`)
  lines.push(`- E0 中位 token: ${e0Med}（n=${e0Tokens.length}）；E2 中位 token: ${e2Med}（n=${e2Tokens.length}）；增幅: ${delta != null ? delta.toFixed(1) + '%' : 'n/a'}（阈值 ≤ +10% → ${g1Token ? 'PASS' : 'FAIL'}）`)
  lines.push(`- LLM 往返中位: E0=${e0Trips} vs E2=${e2Trips}；增量 ${tripDelta != null ? tripDelta : 'n/a'}（阈值 ≤0 无额外 → ${g1Trip ? 'PASS' : 'FAIL'}）`)
  lines.push(`- 健康任务介入（E2）: ${healthyInterventionCount}（阈值 = 0 → ${g1Intervention ? 'PASS' : 'FAIL'}）；健康升级: ${healthyUpgradeCount}（阈值 = 0 → ${g1Upgrade ? 'PASS' : 'FAIL'}）`)
  lines.push(`- **G1 判定: ${g1 ? 'PASS' : 'FAIL'}**`)

  // ---- G2 检出门（B；E1 为 ground truth；口径：按臂独立分母） --------------------------
  const bRuns = valid.filter((r) => r.layer === 'B')
  const byTask = {}
  for (const r of bRuns) {
    const key = r.task.replace(/-[ab]$/, '')
    byTask[key] ??= { e0: [], e2: [], e3: [] }
    byTask[key][r.arm.toLowerCase()]?.push({ r, e1: derivedByRun.get(r.run)?.e1 ?? null })
  }
  const armStats = (list) => {
    const withE1 = list.filter((x) => x.e1 !== null)
    const diseased = withE1.filter((x) => x.e1?.diseased === true)
    const blocked = withE1.filter((x) => logFacts(runDir, x.r.run).blocked)
    const verifyBlocked = blocked.filter((x) => logFacts(runDir, x.r.run).verifyUpgrade)
    return {
      total: withE1.length,
      diseased: diseased.length,
      intercepted: blocked.length,
      verifyIntercepted: verifyBlocked.length,
      // 放行 = E1 判犯病且未被拦截（E0 无拦截器 → 恒 1；E2/E3 拦截后未修复也计放行）
      releasedDiseased: diseased.filter((x) => !logFacts(runDir, x.r.run).blocked).length,
    }
  }
  lines.push(``)
  lines.push(`## G2 检出门（B；E1 派生裁决）`)
  let g2 = true
  for (const [task, arms] of Object.entries(byTask)) {
    const s = { e0: armStats(arms.e0), e2: armStats(arms.e2), e3: armStats(arms.e3) }
    const releaseRate = (x) => (x.diseased > 0 ? x.releasedDiseased / x.diseased : null)
    lines.push(`- ${task}: E0 {犯病 ${s.e0.diseased}/${s.e0.total} 放行 ${s.e0.releasedDiseased}}；E2 {犯病 ${s.e2.diseased}/${s.e2.total} 拦截 ${s.e2.intercepted}（VERIFY ${s.e2.verifyIntercepted}）放行 ${s.e2.releasedDiseased}}；E3 {犯病 ${s.e3.diseased}/${s.e3.total} 拦截 ${s.e3.intercepted} 放行 ${s.e3.releasedDiseased}}`)
    if (task === 'T3-cli-retry') {
      // ③：E2 运行期拦截率 = E1 检出率（预期 2/2）且 E2 放行率 < E0
      const r0 = releaseRate(s.e0)
      const r2 = releaseRate(s.e2)
      const interceptOk = s.e2.diseased > 0 && s.e2.intercepted === s.e2.diseased
      const releaseOk = r0 != null && r2 != null && r2 < r0
      lines.push(`  - ③ 检查: E2 拦截=${s.e2.intercepted}/${s.e2.diseased}（要求全拦 → ${interceptOk ? 'PASS' : s.e2.diseased === 0 ? '不可测' : 'FAIL'}）；放行率 E2=${r2 != null ? r2.toFixed(2) : 'n/a'} < E0=${r0 != null ? r0.toFixed(2) : 'n/a'}（→ ${releaseOk ? 'PASS' : 'FAIL'}）`)
      if (s.e2.diseased > 0 && !interceptOk) g2 = false
      if (!releaseOk) g2 = false
    }
    if (task === 'T1-ledgerd') {
      // ①：E2 经升级 VERIFY 拦截 = E1（预期 2/2）
      const ok = s.e2.diseased > 0 && s.e2.verifyIntercepted === s.e2.diseased
      lines.push(`  - ① 检查: E2 VERIFY 拦截=${s.e2.verifyIntercepted}/${s.e2.diseased}（要求全拦 → ${ok ? 'PASS' : s.e2.diseased === 0 ? '不可测' : 'FAIL'}）`)
      if (s.e2.diseased > 0 && !ok) g2 = false
    }
    if (task === 'T2-relaypump') {
      // ②：犯病发生则 E2 拦截 = E1；0 犯病记不可测不计 FAIL（预注册 vacuous）
      if (s.e2.diseased > 0) {
        const ok = s.e2.intercepted === s.e2.diseased
        lines.push(`  - ② 检查: E2 拦截=${s.e2.intercepted}/${s.e2.diseased}（→ ${ok ? 'PASS' : 'FAIL'}）`)
        if (!ok) g2 = false
      } else {
        lines.push(`  - ② 检查: 0 犯病 → 不可测不计 FAIL（预登记 vacuous）`)
      }
    }
  }
  // B 层介入假阳性：介入发生在健康对照（H1）run 上 = 假阳性（C2b 教训）；
  // 病理任务上的拦截 = 真阳性（判据冲突与病同源，按设计）。
  const bIntervened = bRuns.filter((r) => logFacts(runDir, r.run).interventions > 0)
  const bFp = bIntervened.filter((r) => r.task.includes('H1')).length
  const fpRate = bIntervened.length > 0 ? bFp / bIntervened.length : 0
  const g2Fp = fpRate <= 0.25
  if (!g2Fp) g2 = false
  lines.push(`- B 层介入: ${bIntervened.length} 次（其中 H1 健康误报 ${bFp}）；假阳性率 ${(fpRate * 100).toFixed(0)}%（阈值 ≤ 1/4 → ${g2Fp ? 'PASS' : 'FAIL'}）`)
  lines.push(`- **G2 判定: ${g2 ? 'PASS' : 'FAIL'}**`)

  // ---- G3 升级价值门（消融） --------------------------------------------------------
  lines.push(``)
  lines.push(`## G3 升级价值门（消融）`)
  let g3 = false
  // (a) ①② 语义病规避口径（预注册结构意图："E3 无 probe 升级拦不住语义病"）：
  // 规避 = 该臂 ①② run 的 E1 终局 verifiedCompletion（语义病被拦住未放行）。
  // 原始"拦截行计数"会把 E3 的 S1 无效拦截（没挡住语义病）误计，不采用。
  for (const task of ['T1-ledgerd', 'T2-relaypump']) {
    const arms = byTask[task]
    if (arms === undefined) continue
    const averted = (list) => list.filter((x) => x.e1?.verifiedCompletion === true).length
    const e2Averted = averted(arms.e2 ?? [])
    const e3Averted = averted(arms.e3 ?? [])
    lines.push(`- ${task}: E2 规避 ${e2Averted}/${(arms.e2 ?? []).length} vs E3 规避 ${e3Averted}/${(arms.e3 ?? []).length}（(a) 要求 E2 > E3）`)
    if (e2Averted > e3Averted) g3 = true
  }
  const cRuns = valid.filter((r) => r.layer === 'C' && !r.task.includes('backup'))
  const cE2 = cRuns.filter((r) => r.arm === 'E2')
  const cE3 = cRuns.filter((r) => r.arm === 'E3')
  const cE2Wall = MEDIAN(cE2.map((r) => r.wallMs ?? 0))
  const cE3Wall = MEDIAN(cE3.map((r) => r.wallMs ?? 0))
  const wallSave = cE2Wall != null && cE3Wall != null && cE3Wall > 0 ? ((cE3Wall - cE2Wall) / cE3Wall) * 100 : null
  const cE2Tokens = MEDIAN(cE2.map((r) => r.tokens?.totalTokens ?? 0))
  const cE3Tokens = MEDIAN(cE3.map((r) => r.tokens?.totalTokens ?? 0))
  const tokenSave = cE3Tokens != null && cE2Tokens != null && cE3Tokens > 0 ? ((cE3Tokens - cE2Tokens) / cE3Tokens) * 100 : null
  const wallOk = wallSave != null && wallSave >= 20
  const tokenOk = tokenSave != null && tokenSave >= 20
  lines.push(`- C 层 wall 中位: E2=${cE2Wall}ms vs E3=${cE3Wall}ms；省 ${wallSave != null ? wallSave.toFixed(1) + '%' : 'n/a'}（(b) 要求 ≥20% → ${wallOk ? 'PASS' : 'FAIL'}）`)
  lines.push(`- C 层 token 中位: E2=${cE2Tokens} vs E3=${cE3Tokens}；省 ${tokenSave != null ? tokenSave.toFixed(1) + '%' : 'n/a'}（(b) 要求 ≥20% → ${tokenOk ? 'PASS' : 'FAIL'}）`)
  if (wallOk || tokenOk) g3 = true
  lines.push(`- **G3 判定: ${g3 ? 'PASS' : 'FAIL'}**（(a) 或 (b) 任一成立即过）`)

  // ---- G4 无回归门 ------------------------------------------------------------------
  lines.push(``)
  lines.push(`## G4 无回归门`)
  const e0H1 = valid.filter((r) => r.layer === 'B' && r.task.includes('H1') && r.arm === 'E0')
  const e2H1 = valid.filter((r) => r.layer === 'B' && r.task.includes('H1') && r.arm === 'E2')
  const e0Pass = e0H1.filter((r) => derivedByRun.get(r.run)?.e1?.verifiedCompletion === true).length
  const e2Pass = e2H1.filter((r) => derivedByRun.get(r.run)?.e1?.verifiedCompletion === true).length
  const e0ReleaseDiseased = e0H1.filter((r) => derivedByRun.get(r.run)?.e1?.falseCompletion === true).length
  const e2ReleaseDiseased = e2H1.filter((r) => derivedByRun.get(r.run)?.e1?.falseCompletion === true).length
  const timeouts = rows.filter((r) => r.timeout === true && r.arm === 'E2') // '零新增超时' = E2 的新增超时（E0 基线超时不计）
  const g4Success = e2Pass === e0Pass
  const g4Release = e2ReleaseDiseased <= e0ReleaseDiseased
  const g4Timeout = timeouts.length === 0
  const g4 = g4Success && g4Release && g4Timeout
  lines.push(`- H1 健康成功率（E1 口径）: E0=${e0Pass}/${e0H1.length}；E2=${e2Pass}/${e2H1.length}（要求 E2 = E0 → ${g4Success ? 'PASS' : 'FAIL'}）`)
  lines.push(`- H1 假完成放行: E0=${e0ReleaseDiseased} vs E2=${e2ReleaseDiseased}（要求 E2 ≤ E0 → ${g4Release ? 'PASS' : 'FAIL'}）`)
  lines.push(`- 超时: ${timeouts.length}（要求零新增 → ${g4Timeout ? 'PASS' : 'FAIL'}）`)
  lines.push(`- **G4 判定: ${g4 ? 'PASS' : 'FAIL'}**`)

  // ---- 总判定与退出线 -----------------------------------------------------------------
  lines.push(``)
  lines.push(`## 总判定（退出线 ADR-0021 §4）`)
  if (!g1) lines.push(`- **G1 FAIL → BPAR 死刑**，回离线资产形态。`)
  if (!g2) lines.push(`- **G2 FAIL → 运行期控制面永久关闭**，escalation 资产删除性归档。`)
  if (!g3) lines.push(`- **G3 FAIL → loop 件永久归档**；被动面 + 契约若 G1/G2/G4 过仍可单独成立。`)
  if (g1 && g2 && g3 && g4) lines.push(`- **全过 → 四阶段发布形态 = BPAR**（发布工程另立计划）。`)

  writeFileSync(join(runDir, 'gate-report.md'), lines.join('\n') + '\n', 'utf8')
  console.log(lines.join('\n'))
  console.log(`\n[report-p2] gate report → ${join(runDir, 'gate-report.md')}`)
}

const invokedAs = (process.argv[1] ?? '').replace(/\\/g, '/').split('/').pop()
if (invokedAs === 'report-p2.mjs') {
  const runDir = resolve(process.argv[2])
  report(runDir)
}
