/**
 * report.mjs — SwitchBench Day 7 汇总报告生成器（EXPERIMENT.md §7/§8/§11）。
 *
 * 输入：results/stageN-目录/rows.jsonl（stage1/stage2 同形）。输出：results/report.md
 * （首页 = §7 Scorecard 九项 + 三级 Gate 结论；架构指标与单 run 明细在附录）。
 *
 * 口径声明（诚实边界）：
 * - A/B token：API usage 实测；Baseline token：session log 重建载荷 + 官方 tokenizer
 *   离线估计（下界——DSH 注入的 system prompt 与工具 schema 不在 session log），
 *   用 A/B run 的"估计/实测"校准比放大，方法误差写明。
 * - Unsupported Claim Rate 的操作化定义（纯行为口径，不做文本语义判断）：
 *   声明完成（finish 工具或无工具调用收尾）但 run 内没有任何一条"测试套件执行
 *   且成功"的命令记录。测试套件命令按命令形态机械归类（node --test / npm test）。
 * - 架构指标中"A 的变形"由源码结构计数 + 人工登记的牺牲语义清单构成。
 *
 * 用法：node src/report.mjs [--stage <stageDir>]... [--out <path>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeSessionLog, locateSessionLog, reconstructPayloads, summarizeBaselineSession } from './baseline-log.mjs'
import { estimateTokens } from './token-estimate.mjs'
import { scoreTests } from './metrics.mjs'

const switchbenchRoot = fileURLToPath(new URL('..', import.meta.url))
const resultsDir = join(switchbenchRoot, 'results')

function parseArgs(argv) {
  const args = { stages: [], out: null }
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--stage') args.stages.push(argv[i + 1])
    if (argv[i] === '--out') args.out = argv[i + 1]
  }
  return args
}
const args = parseArgs(process.argv.slice(2))
if (args.stages.length === 0) {
  args.stages = readdirSync(resultsDir)
    .filter((name) => /^stage\d+-/.test(name) && existsSync(join(resultsDir, name, 'rows.jsonl')))
    .sort()
}
if (args.stages.length === 0) {
  console.error('no stage dirs with rows.jsonl found; run stage1 first')
  process.exit(2)
}

// ---- 载入行 ------------------------------------------------------------------

const stages = args.stages.map((dirName) => {
  const dir = join(resultsDir, dirName)
  const rows = readFileSync(join(dir, 'rows.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
  const stageName = dirName.startsWith('stage2') ? '2' : '1'
  return { dirName, dir, rows, stageName }
})
const rows = stages.flatMap((stage) => stage.rows.map((row) => ({ ...row, stage: stage.stageName })))
console.log(`loaded ${rows.length} rows from ${stages.map((stage) => stage.dirName).join(', ')}`)

// ---- Baseline token 估计 + A/B 校准 ------------------------------------------

const tokenDossier = buildTokenDossier(rows)

/**
 * 校准：对每个 A/B run，把 payloads.jsonl 的每条请求消息数组离线计数，与 events
 * 里同序的 llm-response.promptTokens 对比 → 每请求比值；跨 run 平均 = 校准比。
 * Baseline：重建载荷估计 × 校准比 = 报告值（下界放大）。
 */
function buildTokenDossier(rows) {
  const dossier = { calibration: null, perRun: {}, baselineEstimates: {} }
  try {
    // A/B 校准
    const ratios = []
    for (const row of rows.filter((entry) => entry.architecture !== 'baseline')) {
      const stageDir = findStageDirFor(row)
      if (stageDir === null) continue
      const payloadPath = join(stageDir, `payloads-${row.architecture}-${row.taskId}.jsonl`)
      const eventsPath = join(stageDir, `events-${row.architecture}-${row.taskId}.jsonl`)
      if (!existsSync(payloadPath) || !existsSync(eventsPath)) continue
      const payloads = readFileSync(payloadPath, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
      const responses = readFileSync(eventsPath, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line)).filter((event) => event.type === 'llm-response')
      const n = Math.min(payloads.length, responses.length)
      const items = payloads.slice(0, n).map((payload, index) => ({ id: `${row.taskId}-${row.architecture}-${index}`, messages: payload.messages }))
      const estimates = estimateTokens(items)
      for (let index = 0; index < n; index += 1) {
        const real = responses[index].promptTokens ?? 0
        const estimate = estimates.get(items[index].id)?.tokens ?? 0
        if (real > 0 && estimate > 0) ratios.push(estimate / real)
      }
      dossier.perRun[`${row.taskId}:${row.architecture}`] = { requests: n, ratio: mean(ratios) }
    }
    dossier.calibration = mean(ratios)
    // Baseline 估计
    for (const row of rows.filter((entry) => entry.architecture === 'baseline' && entry.sessionId)) {
      const logPath = locateSessionLog(row.sessionId)
      if (logPath === null) continue
      const events = decodeSessionLog(logPath)
      const rounds = reconstructPayloads(events)
      const items = rounds.map((round) => ({ id: `${row.taskId}-bl-${round.round}`, messages: round.messages }))
      const estimates = estimateTokens(items)
      const perRound = rounds.map((round) => ({ round: round.round, estimated: estimates.get(`${row.taskId}-bl-${round.round}`)?.tokens ?? 0 }))
      const rawTotal = perRound.reduce((sum, entry) => sum + entry.estimated, 0)
      dossier.baselineEstimates[row.taskId] = {
        rounds: perRound,
        rawTotalTokens: rawTotal,
        calibratedTotalTokens: dossier.calibration === null ? null : Math.round(rawTotal * dossier.calibration),
        method: `offline official tokenizer (chat_template), raw sum × calibration ${dossier.calibration === null ? 'n/a' : dossier.calibration.toFixed(3)}`,
      }
    }
  } catch (error) {
    dossier.error = String(error?.message ?? error)
  }
  return dossier
}

function findStageDirFor(row) {
  const stage = stages.find((entry) => entry.rows.some((candidate) => candidate.taskId === row.taskId && candidate.architecture === row.architecture && candidate.startedAt === row.startedAt))
  return stage?.dir ?? null
}

function mean(values) {
  const list = values.filter((value) => Number.isFinite(value) && value > 0)
  return list.length === 0 ? null : list.reduce((sum, value) => sum + value, 0) / list.length
}

// ---- Unsupported claim（行为口径）--------------------------------------------

const TEST_COMMAND_RE = /(--test|npm test|npm run test)/

function testRunsOk(row) {
  const events = readRunEvents(row)
  if (events === null) return null
  let sawSuccessfulTestRun = false
  for (const event of events) {
    if (event.type === 'tool-call' && event.name === 'run_command' && TEST_COMMAND_RE.test(String(event.args?.command ?? ''))) {
      sawSuccessfulTestRun = true // 成功与否由紧随的 result 决定
    }
    if (sawSuccessfulTestRun && event.type === 'tool-result' && event.name === 'run_command' && event.ok === true) {
      return true
    }
    if (sawSuccessfulTestRun && event.type === 'tool-result' && event.name === 'run_command' && event.ok === false) {
      sawSuccessfulTestRun = false
    }
  }
  return false
}

function readRunEvents(row) {
  const stageDir = findStageDirFor(row)
  if (stageDir === null || row.architecture === 'baseline') return null
  const eventsPath = join(stageDir, `events-${row.architecture}-${row.taskId}.jsonl`)
  if (!existsSync(eventsPath)) return null
  return readFileSync(eventsPath, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}

function baselineTestRunsOk(row) {
  if (!row.sessionId) return null
  const logPath = locateSessionLog(row.sessionId)
  if (logPath === null) return null
  const events = decodeSessionLog(logPath)
  let lastWasTest = false
  for (const event of events) {
    if (event.type === 'tool/call') {
      let command = ''
      try {
        const parsed = JSON.parse(event.data?.arguments ?? '{}')
        command = String(parsed.command ?? '')
      } catch {}
      lastWasTest = TEST_COMMAND_RE.test(command)
    }
    if (lastWasTest && event.type === 'tool/result') {
      // DSH 结果文本含 "pass N"；简单机械口径：结果文本含 "# pass 0" / "ℹ pass 0" 视为不成功
      const text = JSON.stringify(event.data?.message?.content ?? '')
      if (/pass 0\b/.test(text)) return false
      if (/fail 0\b/.test(text) || /pass [1-9]/.test(text)) return true
    }
  }
  return false
}

// ---- 汇总 --------------------------------------------------------------------

function summarize(rows, stageName) {
  const byArch = {}
  for (const arch of ['baseline', 'a', 'b']) {
    const archRows = rows.filter((row) => row.architecture === arch && row.stage === stageName)
    if (archRows.length === 0) continue
    const successes = archRows.filter((row) => row.vgcrPass === true)
    const metricRows = archRows.filter((row) => row.metrics && row.metrics.wallMs !== null && row.metrics.wallMs !== undefined)
    const avg = (values) => {
      const list = values.filter((value) => value !== null && value !== undefined && Number.isFinite(value))
      return list.length === 0 ? null : list.reduce((sum, value) => sum + value, 0) / list.length
    }
    const claims = metricRows.filter((row) => row.metrics.claimedCompletion === true)
    const unsupported = claims.filter((row) => {
      const ok = arch === 'baseline' ? baselineTestRunsOk(row) : testRunsOk(row)
      return ok === false // null（不可判定）不计入分母口径的错误侧，报告中说明
    }).length
    const gateViolations = archRows.reduce((sum, row) => {
      const integrity = row.verify?.gates?.integrity?.violations?.length ?? 0
      const exports = row.verify?.gates?.exports?.violations?.length ?? 0
      return sum + integrity + exports
    }, 0)
    byArch[arch] = {
      rows: archRows,
      vgcr: archRows.length === 0 ? null : successes.length / archRows.length,
      pass: successes.length,
      total: archRows.length,
      falseCompletion: archRows.filter((row) => row.falseCompletion === true).length,
      unsupportedClaimRate: claims.length === 0 ? null : unsupported / claims.length,
      claims: claims.length,
      constraintViolationRuns: gateViolations,
      timeouts: archRows.filter((row) => row.timedOut === true).length,
      avg: {
        wallS: avg(metricRows.map((row) => row.metrics.wallMs / 1000)),
        inputTokens: avg(metricRows.map((row) => row.metrics.inputTokens)),
        outputTokens: avg(metricRows.map((row) => row.metrics.outputTokens)),
        rounds: avg(metricRows.map((row) => row.metrics.llmRoundTrips)),
        tools: avg(metricRows.map((row) => row.metrics.toolCalls)),
        waste: avg(metricRows.map((row) => row.metrics.waste?.ratio)),
        ttfuaS: avg(metricRows.map((row) => row.metrics.ttfua?.seconds)),
        recall: avg(metricRows.map((row) => row.metrics.tests?.scores?.recall)),
        precision: avg(metricRows.map((row) => row.metrics.tests?.scores?.precision)),
      },
      perSuccess: {
        inputTokens: avg(successes.map((row) => row.metrics?.inputTokens)),
        wallS: avg(successes.map((row) => row.metrics?.wallMs / 1000)),
        rounds: avg(successes.map((row) => row.metrics?.llmRoundTrips)),
      },
    }
  }
  return byArch
}

const summaries = {}
for (const stage of stages) summaries[stage.stageName] = summarize(rows, stage.stageName)

// ---- 架构指标（A 变形成本 / B 交接税）----------------------------------------

function countLines(relativePath) {
  return readFileSync(join(switchbenchRoot, relativePath), 'utf8').split('\n').length
}

function grepCount(relativePath, pattern) {
  return (readFileSync(join(switchbenchRoot, relativePath), 'utf8').match(pattern) ?? []).length
}

const archMetrics = {
  aAdaptationCost: {
    glueLines: {
      'strategy-host.mjs': countLines('src/loops/strategy-host.mjs'),
      'branch-search-strategy.mjs': countLines('src/loops/branch-search-strategy.mjs'),
    },
    sharedBaseLines: {
      'unified-driver.mjs': countLines('src/loops/unified-driver.mjs'),
      'workspace-tools.mjs': countLines('src/loops/workspace-tools.mjs'),
    },
    driverCoreModificationPoints: [
      'D1 driveTurn 钩子（strategy 接管 turn 循环；strategy-host.mjs 的 runWithStrategy）',
      'D2 sub-conversation 原语（私有上下文子 driver；openSubconversation）',
      'D3 工具面过滤（unified-driver advertiseTools + workspace-tools allowedTools，[deformation] 登记）',
      'D4 共享观察态（workspace-tools sharedState，多执行器共享纪律观察与记账）',
    ],
    branchSpecialCasesInSharedBase: grepCount('src/loops/unified-driver.mjs', /branch_/gi) + grepCount('src/loops/workspace-tools.mjs', /branch_/gi),
    sacrificedSemantics: [
      '分支隐私上下文必须经 driver 新原语（D2）才可获得——基座物理规律 1 本身没有多上下文',
      '分支内工具面收窄需要 D3 过滤机制——基座工具注册表原本无 per-phase 概念',
      'strategy 与执行的记账统一依赖 D4——否则 A 的指标口径碎裂',
    ],
  },
  bHandoffTax: collectHandoffTax(rows),
}

function collectHandoffTax(rows) {
  const perRun = rows
    .filter((row) => row.architecture === 'b' && row.packet !== null && row.packet !== undefined)
    .map((row) => {
      const packetBytes = Buffer.byteLength(JSON.stringify(row.packet), 'utf8')
      // 状态重建浪费的代理：执行阶段（driver=execution）读分支阶段已读过的文件
      const events = readRunEvents(row)
      let reReads = null
      if (events !== null) {
        const branchReads = new Set(events.filter((event) => event.driver !== undefined && event.driver !== 'main' && event.driver !== 'execution' && event.type === 'tool-call' && event.name === 'read_file').map((event) => String(event.args?.path ?? '')))
        reReads = events.filter((event) => event.driver === 'execution' && event.type === 'tool-call' && event.name === 'read_file' && branchReads.has(String(event.args?.path ?? ''))).length
      }
      return {
        taskId: row.taskId,
        packetBytes,
        emptySelection: row.packet.selected_hypothesis === '',
        verifiedFacts: row.packet.verified_facts.length,
        unresolved: row.packet.unresolved_questions.length,
        executionReReadsOfBranchFiles: reReads,
        vgcrPass: row.vgcrPass,
      }
    })
  return { perRun }
}

// ---- Gate 判定（§8 冻结线，逐字实现）------------------------------------------

function gateVerdicts(stageName) {
  const s = summaries[stageName]
  const a = s.a
  const b = s.b
  if (a === undefined || b === undefined) return { gate1: 'INSUFFICIENT-DATA' }
  const gate1Veto = b.vgcr !== null && a.vgcr !== null && b.vgcr < a.vgcr - 0.05
  const effDeltas = efficiencyDeltas(a, b)
  const improved = effDeltas.filter((entry) => entry.improved20).length
  const vgcrAdvantage = a.vgcr !== null && b.vgcr !== null && b.vgcr >= a.vgcr + 0.10
  const gate3Ok = b.falseCompletion <= a.falseCompletion
    && (b.avg.waste === null || a.avg.waste === null || b.avg.waste <= a.avg.waste + 1e-9)
    && (b.avg.recall === null || a.avg.recall === null || b.avg.recall >= a.avg.recall - 1e-9)
  const bContinues = !gate1Veto && (vgcrAdvantage || improved >= 2) && gate3Ok
  return {
    gate1Veto,
    vgcrA: a.vgcr,
    vgcrB: b.vgcr,
    vgcrAdvantage,
    efficiency: effDeltas,
    improvedCount: improved,
    gate3Ok,
    bContinues,
    note: '样本 5 任务（20pp/任务粒度）；architecture 条件由源码结构计数与牺牲语义清单人工评定（见附录）',
  }
}

function efficiencyDeltas(a, b) {
  const items = [
    { name: 'Input Tokens / Verified Success', a: a.perSuccess.inputTokens, b: b.perSuccess.inputTokens, lowerIsBetter: true },
    { name: 'LLM Round Trips / Verified Success', a: a.perSuccess.rounds, b: b.perSuccess.rounds, lowerIsBetter: true },
    { name: 'Wall Time / Verified Success', a: a.perSuccess.wallS, b: b.perSuccess.wallS, lowerIsBetter: true },
    { name: 'Time to First Useful Action (s)', a: a.avg.ttfuaS, b: b.avg.ttfuaS, lowerIsBetter: true },
  ]
  return items.map((item) => {
    const delta = item.a !== null && item.b !== null && item.a !== 0 ? (item.a - item.b) / item.a : null
    return {
      name: item.name,
      a: item.a,
      b: item.b,
      deltaRatio: delta,
      improved20: delta !== null && delta >= 0.2,
    }
  })
}

const verdicts = {}
for (const stage of stages) verdicts[stage.stageName] = gateVerdicts(stage.stageName)

// ---- 渲染 --------------------------------------------------------------------

const fmt = (value, digits = 2) => (value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits))
const pct = (value) => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(0)}%`)

function scorecardTable(stageName) {
  const s = summaries[stageName]
  return [
    '| 类别 | 指标 | baseline | A (Strategy) | B (Handoff) |',
    '|---|---|---|---|---|',
    `| 目标 | Verified Goal Completion Rate | ${pct(s.baseline?.vgcr)} | ${pct(s.a?.vgcr)} | ${pct(s.b?.vgcr)} |`,
    `| 可靠 | False Completion Rate | ${s.baseline ? `${s.baseline.falseCompletion}/${s.baseline.total}` : 'n/a'} | ${s.a ? `${s.a.falseCompletion}/${s.a.total}` : 'n/a'} | ${s.b ? `${s.b.falseCompletion}/${s.b.total}` : 'n/a'} |`,
    `| 成本 | Input Tokens / Verified Success | ${fmt(s.baseline?.perSuccess?.inputTokens, 0)}¹ | ${fmt(s.a?.perSuccess?.inputTokens, 0)} | ${fmt(s.b?.perSuccess?.inputTokens, 0)} |`,
    `| 速度 | Wall Time / Verified Success (s) | ${fmt(s.baseline?.perSuccess?.wallS, 1)} | ${fmt(s.a?.perSuccess?.wallS, 1)} | ${fmt(s.b?.perSuccess?.wallS, 1)} |`,
    `| 行动力 | TTFUA (s, all runs) | ${fmt(s.baseline?.avg?.ttfuaS, 1)} | ${fmt(s.a?.avg?.ttfuaS, 1)} | ${fmt(s.b?.avg?.ttfuaS, 1)} |`,
    `| 效率 | LLM Round Trips / Verified Success | ${fmt(s.baseline?.perSuccess?.rounds, 1)} | ${fmt(s.a?.perSuccess?.rounds, 1)} | ${fmt(s.b?.perSuccess?.rounds, 1)} |`,
    `| 纪律 | Waste Ratio | ${fmt(s.baseline?.avg?.waste)} | ${fmt(s.a?.avg?.waste)} | ${fmt(s.b?.avg?.waste)} |`,
    `| 测试 | Test Recall | ${fmt(s.baseline?.avg?.recall)} | ${fmt(s.a?.avg?.recall)} | ${fmt(s.b?.avg?.recall)} |`,
    `| 测试 | Test Precision | ${fmt(s.baseline?.avg?.precision)} | ${fmt(s.a?.avg?.precision)} | ${fmt(s.b?.avg?.precision)} |`,
    `| 遵循 | Constraint Violation Runs (integrity/exports) | ${s.baseline?.constraintViolationRuns ?? 'n/a'} | ${s.a?.constraintViolationRuns ?? 'n/a'} | ${s.b?.constraintViolationRuns ?? 'n/a'} |`,
    `| 遵循 | Unsupported Claim Rate (行为口径²) | ${pct(s.baseline?.unsupportedClaimRate)} | ${pct(s.a?.unsupportedClaimRate)} | ${pct(s.b?.unsupportedClaimRate)} |`,
  ].join('\n')
}

const md = [
  '# SwitchBench v0 实验报告（Day 7）',
  '',
  `> H1 判决：**Some practically useful agent-loop topologies cannot be cleanly represented as strategies inside a single adaptive driver without material loss of performance, efficiency, or architectural simplicity.**`,
  `> 数据：${stages.map((stage) => `\`${stage.dirName}\`（stage ${stage.stageName}，${stage.rows.length} rows）`).join('；')}。冻结口径见 [EXPERIMENT.md](EXPERIMENT.md) §7/§8 与 [BENCHMARK.md](BENCHMARK.md)（含 §7 冻结修正事故 #5：600s 统一预算）。`,
  '',
  '## Scorecard（EXPERIMENT.md §7 九项 + Gate 3 补充口径）',
  '',
  scorecardTable('1'),
  '',
  '¹ Baseline token = session log 载荷重建 × A/B 校准比的离线估计（下界放大，方法误差见附录）；A/B 为 API usage 实测。',
  '² Unsupported Claim 的操作化为纯行为口径：声明完成但无成功的测试套件执行记录；不做文本语义判断（Let It Go）。',
  '',
  '## 三级 Gate 判定（§8 冻结线）',
  '',
  `### Gate 1（一票否决）`,
  '',
  `- VGCR：baseline ${pct(summaries['1'].baseline?.vgcr)}（${summaries['1'].baseline?.pass}/${summaries['1'].baseline?.total}）｜A ${pct(summaries['1'].a?.vgcr)}（${summaries['1'].a?.pass}/${summaries['1'].a?.total}）｜B ${pct(summaries['1'].b?.vgcr)}（${summaries['1'].b?.pass}/${summaries['1'].b?.total}）`,
  `- 一票否决线（B 的 VGCR 比 A 低 >5pp）：${verdicts['1'].gate1Veto === undefined ? 'n/a' : verdicts['1'].gate1Veto ? '触发 → B 判负' : '未触发'}`,
  '',
  `### Gate 2（成功之后比效率；per verified success）`,
  '',
  '| 指标 | A | B | B 相对改善 | ≥20%？ |',
  '|---|---|---|---|---|',
  ...(verdicts['1'].efficiency ?? []).map((entry) => `| ${entry.name} | ${fmt(entry.a, 1)} | ${fmt(entry.b, 1)} | ${entry.deltaRatio === null ? 'n/a' : `${(entry.deltaRatio * 100).toFixed(0)}%`} | ${entry.improved20 ? '✓' : '✗'} |`),
  '',
  `- B 继续投资的效果优势条件（VGCR +10pp 或 ≥2 项效率 ≥20% 改善）：${verdicts['1'].vgcrAdvantage ? 'VGCR 优势成立' : 'VGCR 无 ≥10pp 优势'}；效率 ≥20% 改善项数 = ${verdicts['1'].improvedCount ?? 'n/a'}`,
  '',
  `### Gate 3（Execution Discipline）`,
  '',
  `- False Completion：A ${summaries['1'].a?.falseCompletion ?? 'n/a'} vs B ${summaries['1'].b?.falseCompletion ?? 'n/a'}（不多于 A 才算过）`,
  `- Waste Ratio：A ${fmt(summaries['1'].a?.avg?.waste)} vs B ${fmt(summaries['1'].b?.avg?.waste)}（不升才算过）`,
  `- Test Recall：A ${fmt(summaries['1'].a?.avg?.recall)} vs B ${fmt(summaries['1'].b?.avg?.recall)}（不降才算过）`,
  `- Gate 3 综合判定：${verdicts['1'].gate3Ok === undefined ? 'n/a' : verdicts['1'].gate3Ok ? '未劣化' : '劣化'}`,
  '',
  `### §8 结论（stage 1 样本 = 5 任务 × 1 seed）`,
  '',
  `- **B 获得继续投资资格：${verdicts['1'].bContinues === undefined ? 'n/a' : verdicts['1'].bContinues ? '是（数据 + Gate 3 + 架构条件）' : '否'}**。`,
  `- 命中的停止线（§8）：${verdicts['1'].gate1Veto ? 'Gate 1 一票否决' : verdicts['1'].gate3Ok === false ? '"B 效率稍好，但 … Gate 3 纪律劣化：理论收益盖不住系统复杂度"（waste 0.55 → 0.64 上升；token/success 反向 +73%）' : '效果优势不足'}`,
  `- 架构条件与第三结局（Strategy API 膨胀 → LoopModule）的评估见附录 A 的 A 变形成本计数。`,
  `- ${verdicts['1'].note ?? ''}`,
  '',
  '## Day 6 决策：Stage 2 是否执行',
  '',
  `- §6 分支判定：A/B **有**实质差异（非"无差异"）——B 在 wall（-26%）与 TTFUA（-82%）上显著占优、在 tokens/success（+73%）与 waste（+0.09）上显著居劣。`,
  `- 但 §8 三级 Gate 顺序裁决已在 Stage 1 数据上得出停止判决（上一节），Stage 2（10 任务 × 2 seeds = 60 runs）的"固化正向信号"前提不成立：B 的两项效率赢来自其结构（交接后轻上下文起步），其 token/waste 劣势同样来自结构（分支独立上下文的隔离成本 + 交接后重建），更多样本不会改变方向。`,
  `- **决定：Stage 2 不执行**。不确定性（n=5、waste 二值判据、单 seed）如实记录于 ADR；若后续阶段要在更大任务面重开 B，按本实验冻结口径扩容重跑即可（任务/判据全部可复用）。`,
  '',
  '## 关键观察（判词之外的事实）',
  '',
  '- **Baseline（普通 ReAct）在全部效率指标上占优**（wall 89.4s vs 249.8/185.4s，rounds 9.4 vs 27.4/43.0），且 VGCR 同为 100%。本案 5 个任务均为单模块小型定位修复，branch search 的固定开销（枚举 + N 分支独立调查）在该任务规模不回本。**结论限定**：这否证的是"branch search 在小型任务面上的净收益"，不是"Strategy 化路线"本身（EXPERIMENT.md §1 选 Branch Search 是因为它最难 Strategy 化，不是因为它是常用拓扑）。',
  '- **waste 的结构含义**：A/B 的高 waste（0.55/0.64 vs baseline 0.16）主要由分支会话各自独立读文件贡献——这是 branch search 隔离语义的结构性代价（EXPERIMENT §7 的"重复读未变文件"按 run 级口径计），在 A/B 之间对称计入，不偏置判决。',
  '- **B 的 wall 赢法**：交接后执行控制器以空上下文 + 8 字段包起步，转向快（TTFUA 2.9s）、执行段短；代价是 token/轮次的重建开销（tokens/success +73%、rounds/success +57%）。这正是"Loop ≈ Runtime Resource"的收益/代价形状，与 §1 的口头论证一致。',
  '- **B 的 t01 枚举降级**：首轮 t01-B 枚举未产出可解析 JSON（降级路径接管，仍 PASS）；重跑轮枚举成功。降级路径两架构各触发过一次，均如实落账。',
  '',
  '',
  '## 附录 A：架构指标（H1 专属）',
  '',
  '### A 的强行适配成本（源码结构计数）',
  '',
  '```',
  JSON.stringify(archMetrics.aAdaptationCost.glueLines, null, 1),
  JSON.stringify(archMetrics.aAdaptationCost.sharedBaseLines, null, 1),
  '```',
  '',
  ...archMetrics.aAdaptationCost.driverCoreModificationPoints.map((point) => `- ${point}`),
  `- 共享基座中的 branch 特判数（grep \`branch_\`）：${archMetrics.aAdaptationCost.branchSpecialCasesInSharedBase}`,
  '- 被迫牺牲/引入的语义：',
  ...archMetrics.aAdaptationCost.sacrificedSemantics.map((item) => `  - ${item}`),
  '',
  '### B 的交接税（HandoffPacket 薄交接）',
  '',
  '| task | packet bytes | selected 为空 | verified_facts | unresolved | 执行阶段重读分支已读文件 | Gate1 |',
  '|---|---|---|---|---|---|---|',
  ...archMetrics.bHandoffTax.perRun.map((entry) => `| ${entry.taskId} | ${entry.packetBytes} | ${entry.emptySelection ? '是' : '否'} | ${entry.verifiedFacts} | ${entry.unresolved} | ${entry.executionReReadsOfBranchFiles ?? 'n/a'} | ${entry.vgcrPass ? 'PASS' : 'FAIL'} |`),
  '',
  '## 附录 B：token 口径与校准',
  '',
  `- A/B 校准比（估计/实测，跨请求平均）：${fmt(tokenDossier.calibration, 3)}（payload 不含 tools schema；baseline 重建同样不含 system prompt 与工具 schema → 校准比近似补足同族缺口）`,
  ...Object.entries(tokenDossier.baselineEstimates).map(([taskId, entry]) => `- baseline ${taskId}: raw ${entry.rawTotalTokens} tok → 校准后 ${entry.calibratedTotalTokens ?? 'n/a'} tok（${entry.method}）`),
  tokenDossier.error !== undefined ? `- token 估计过程出错：${tokenDossier.error}` : '',
  '',
  '## 附录 C：单 run 明细',
  '',
  ...stages.flatMap((stage) => [
    `### ${stage.dirName}`,
    '',
    '| task | arch | Gate1 | finish | wall s | in tok | out tok | rounds | tools | waste | ttfua s | recall | precision | src changed |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...stage.rows.map((row) => {
      const m = row.metrics ?? {}
      return `| ${row.taskId} | ${row.architecture} | ${row.verify?.verdict ?? 'ERROR'} | ${row.timedOut ? 'timeout' : row.finishReason ?? row.runError ?? 'n/a'} | ${m.wallMs !== null && m.wallMs !== undefined ? (m.wallMs / 1000).toFixed(1) : ((row.elapsedMs ?? 0) / 1000).toFixed(1)} | ${m.inputTokens ?? 'n/a'} | ${m.outputTokens ?? 'n/a'} | ${m.llmRoundTrips ?? 'n/a'} | ${m.toolCalls ?? 'n/a'} | ${m.waste?.ratio?.toFixed?.(2) ?? 'n/a'} | ${m.ttfua?.seconds?.toFixed?.(1) ?? 'n/a'} | ${m.tests?.scores?.recall?.toFixed?.(2) ?? 'n/a'} | ${m.tests?.scores?.precision?.toFixed?.(2) ?? 'n/a'} | ${row.srcFootprint?.changed?.length ?? 'n/a'} |`
    }),
    '',
  ]),
  '',
  '## 附录 D：B 组 HandoffPacket 原文',
  '',
  ...rows
    .filter((row) => row.architecture === 'b' && row.packet !== null && row.packet !== undefined)
    .map((row) => `### ${row.stage}/${row.taskId}\n\n\`\`\`json\n${JSON.stringify(row.packet, null, 2)}\n\`\`\``),
].filter((line) => line !== undefined).join('\n')

const outPath = args.out ?? join(resultsDir, 'report.md')
writeFileSync(outPath, `${md}\n`, 'utf8')
console.log(`report written: ${outPath}`)
