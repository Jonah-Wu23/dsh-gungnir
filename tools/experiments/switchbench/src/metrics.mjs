/**
 * metrics.mjs — SwitchBench 指标采集（EXPERIMENT.md §7 三级 Gate 的机器口径）。
 *
 * A/B 架构：从 run 事件流（model client + workspace tools + driver/loop 事件）
 * 计算。Baseline：从 DSH session log（见 baseline-log.mjs）取可得子集。
 *
 * 冻结口径（报告必须原样引用）：
 * - Input Tokens：API usage.prompt_tokens 累计（含缓存命中部分；缓存命中量单列）。
 * - LLM Round Trips：llm-response 事件数。
 * - Wall Time：run 起止墙钟。
 * - Time to First Useful Action：首个"有用"工具调用前的秒数 / LLM calls / 工具
 *   调用数。有用 = write_file | run_command | read_file(此前未读过的路径)；开场
 *   第一个 list_dir 视为有用（提供目录结构信息），其后的 list_dir 一律浪费。
 *   不测 CoT，不依赖模型私有推理（§7 外部行为口径）。
 * - Waste Ratio：浪费工具调用 / 全部工具调用。浪费 = ①读此前读过且此后未被改写
 *   的文件；②开场之后的 list_dir；③与先前完全相同的命令且其间无任何 write_file
 *   （近似口径：无法观测命令自身的副作用，报告注明）。finish 不计入分母。
 * - False Completion：run 正常收口（finish 工具 / 无工具调用的纯文本收尾）而
 *   Gate-1 verifier FAIL。超时/中断不算 claim，不计入。
 * - Constraint Violation（机器可检部分）：路径逃逸事件 + 越权写（write_file 到
 *   src/ 之外）+ verifier integrity/exports 违规（runner 层并入）。
 * - Test Precision/Recall：run_command 输出中的 TAP 测试名对 MUST/SHOULD/IRRELEVANT
 *   冻结标注计分。Recall = 已执行 ∩ 必要 / 必要（MUST∪SHOULD）；Precision =
 *   已执行 ∩ 必要 / 已执行（IRRELEVANT 拉低 Precision）。无 TAP 输出不计。
 */

/** 单遍重放事件流：行为质量 + TTFUA。 */
export function computeBehaviorMetrics(events, startedAtMs) {
  const readPaths = new Set()
  const pendingWrites = new Set() // 自上次命令以来的 write_file 路径
  const commandHistory = [] // {command, mutatedAny}
  let totalCalls = 0
  let wastedCalls = 0
  let llmCallsBeforeFirstUseful = 0
  let llmResponseCount = 0
  let firstUseful = null
  let claimedCompletion = false
  let finishReason = null
  const pathEscapes = []
  const outsideSrcWrites = []
  const commandOutputs = [] // {command, output}

  for (const event of events) {
    if (event.type === 'llm-response') {
      llmResponseCount += 1
      if (firstUseful === null) llmCallsBeforeFirstUseful = llmResponseCount
      continue
    }
    if (event.type === 'driver-run-end' && (event.driver === 'main' || event.driver === 'execution')
      && (event.finishReason === 'finish-tool' || event.finishReason === 'no-tool-calls')) {
      // 只统计主上下文 driver（A 的 'main' / B 的 'execution'）的收口；
      // strategy 子会话（enumerate/branch-*）的 no-tool-calls 收口是阶段事件，
      // 不是对任务的完成声明，不得计入（否则 claimedCompletion 被污染）。
      claimedCompletion = true
      finishReason = event.finishReason
      continue
    }
    if (event.type === 'violation' && event.kind === 'path-escape') {
      pathEscapes.push(event.path)
      continue
    }
    if (event.type === 'tool-result' && event.name === 'run_command' && typeof event.output === 'string') {
      commandOutputs.push({ output: event.output })
      continue
    }
    if (event.type !== 'tool-call') continue
    if (event.name === 'finish') continue // 收尾信号不算动作（分母口径）
    totalCalls += 1

    let useful = false
    let wasted = false
    if (event.name === 'read_file') {
      const path = String(event.args?.path ?? '')
      if (readPaths.has(path)) wasted = true
      else {
        useful = true
        readPaths.add(path)
      }
    } else if (event.name === 'list_dir') {
      if (firstUseful === null) useful = true // 开场列目录：结构信息
      else wasted = true
    } else if (event.name === 'write_file') {
      useful = true
      const path = String(event.args?.path ?? '').replace(/\\/g, '/')
      if (!path.startsWith('src/')) outsideSrcWrites.push(path)
      pendingWrites.add(path)
    } else if (event.name === 'run_command') {
      const command = String(event.args?.command ?? '')
      const repeat = commandHistory.some((entry) => entry.command === command && entry.mutatedAny === false)
      if (repeat) wasted = true
      else useful = true
      commandHistory.push({ command, mutatedAny: pendingWrites.size > 0 })
      pendingWrites.clear()
    }

    if (firstUseful === null && useful) {
      firstUseful = { t: event.t, toolCallsBefore: totalCalls - 1 }
    }
    if (wasted) wastedCalls += 1
  }

  return {
    toolCalls: totalCalls,
    wastedCalls,
    wasteRatio: totalCalls === 0 ? 0 : wastedCalls / totalCalls,
    ttfua: firstUseful === null ? null : {
      seconds: (firstUseful.t - startedAtMs) / 1000,
      llmCallsBefore: llmCallsBeforeFirstUseful,
      toolCallsBefore: firstUseful.toolCallsBefore,
    },
    claimedCompletion,
    finishReason,
    pathEscapes,
    outsideSrcWrites,
    commandOutputs,
  }
}

/** 从事件流提取 run_command 输出中的测试名（TAP 与 node spec reporter 两种格式）。 */
export function extractExecutedTests(events) {
  const behavior = computeBehaviorMetrics(events, 0)
  const testNames = new Set()
  for (const { output } of behavior.commandOutputs) {
    collectTestNames(output, testNames)
  }
  return [...testNames]
}

/** TAP（`ok N - name`）与 node 默认 spec reporter（`✔ name (t)` / `✖ name (t)`）双格式。 */
export function collectTestNames(output, sink) {
  for (const match of output.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)) sink.add(match[1].trim())
  for (const match of output.matchAll(/^[✔✖] (.+?) \([\d.]+(?:ms|s)\)\s*$/gm)) sink.add(match[1].trim())
  return sink
}

/** Test Precision/Recall（对冻结标注计分）。 */
export function scoreTests(executedNames, annotations) {
  const must = new Set(annotations.MUST ?? [])
  const should = new Set(annotations.SHOULD ?? [])
  const irrelevant = new Set(annotations.IRRELEVANT ?? [])
  const necessary = new Set([...must, ...should])
  const executed = executedNames.filter((name) => must.has(name) || should.has(name) || irrelevant.has(name))
  const executedNecessary = executed.filter((name) => necessary.has(name))
  return {
    recall: necessary.size === 0 ? null : executedNecessary.length / necessary.size,
    precision: executed.length === 0 ? null : executedNecessary.length / executed.length,
    executedCount: executed.length,
    executedNecessaryCount: executedNecessary.length,
    necessaryTotal: necessary.size,
    missedMust: [...necessary].filter((name) => !executedNecessary.includes(name)),
    executedIrrelevant: executed.filter((name) => irrelevant.has(name)),
    unmatchedExecuted: executedNames.filter((name) => !must.has(name) && !should.has(name) && !irrelevant.has(name)),
  }
}

/**
 * 从 A/B run 事件流汇总全部指标。
 * @param {Array<object>} events 带 t 时间戳的事件流
 * @param {object} timing {startedAtMs, endedAtMs}
 * @param {object} [annotations] 任务测试标注（tasks.mjs tests 字段）
 */
export function summarizeRun(events, timing, annotations) {
  const llmResponses = events.filter((event) => event.type === 'llm-response')
  const inputTokens = llmResponses.reduce((sum, event) => sum + (event.promptTokens ?? 0), 0)
  const outputTokens = llmResponses.reduce((sum, event) => sum + (event.completionTokens ?? 0), 0)
  const cachedTokens = llmResponses.reduce((sum, event) => sum + (event.cachedTokens ?? 0), 0)
  const llmErrors = events.filter((event) => event.type === 'llm-error').length

  const behavior = computeBehaviorMetrics(events, timing.startedAtMs ?? events[0]?.t ?? 0)
  const executedTests = extractExecutedTests(events)

  return {
    wallMs: (timing.endedAtMs ?? events[events.length - 1]?.t ?? 0) - (timing.startedAtMs ?? events[0]?.t ?? 0),
    inputTokens,
    outputTokens,
    cachedTokens,
    llmRoundTrips: llmResponses.length,
    llmErrors,
    toolCalls: behavior.toolCalls,
    ttfua: behavior.ttfua,
    waste: { ratio: behavior.wasteRatio, wasted: behavior.wastedCalls, total: behavior.toolCalls },
    claimedCompletion: behavior.claimedCompletion,
    finishReason: behavior.finishReason,
    constraintViolations: {
      pathEscapes: behavior.pathEscapes,
      outsideSrcWrites: behavior.outsideSrcWrites,
    },
    tests: { executed: executedTests, scores: annotations === undefined ? null : scoreTests(executedTests, annotations) },
  }
}
