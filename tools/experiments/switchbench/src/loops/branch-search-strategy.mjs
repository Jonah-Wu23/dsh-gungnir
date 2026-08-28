/**
 * branch-search-strategy.mjs — 方案 A：Branch Search 住进 UnifiedDriver 契约内部。
 *
 * 这是"对方案 A 最公平、最强的实现"（EXPERIMENT.md §3）：Branch Search 以
 * Strategy 身份活在统一契约里，用 strategy-host 提供的原语（D1 driveTurn /
 * D2 sub-conversation / D3 工具面过滤 / D4 共享观察态）实现多假设并行调查。
 * 调查语义（提示词、工具面、上限、报告 schema、收敛规则）与 B 组共用
 * branch-protocol.mjs——两架构唯一差异是 Branch Search 住在哪里。
 *
 * 与 B 的本质差别在收敛之后：A 不交接——strategy 直接把全部调查产出（所有分支
 * 的报告，不止 8 字段）写进主上下文，同一个 driver 实例继续执行阶段。这是
 * "Loop ≈ Policy"的自然优势：策略与执行之间没有信息瓶颈，也没有交接税。
 *
 * 阶段流：ENUMERATE（子会话枚举假设，丢弃上下文只留假设清单）
 *       → INVESTIGATE（每假设一个并行子会话，产独立报告）
 *       → CONVERGE（确定性收敛 selectHypothesis）
 *       → EXECUTE（全部报告入主上下文 → 标准 turn 直到 finish）
 */
import { openSubconversation, runWithStrategy } from './strategy-host.mjs'
import {
  BRANCH_CAPS,
  BRANCH_TOOLSET,
  ENUMERATION_PROMPT,
  ENUMERATION_REQUEST,
  REPORT_REQUEST,
  TASK_BRIEF,
  investigationSystemPrompt,
  parseReport,
  selectHypothesis,
} from './branch-protocol.mjs'
import { toolSchemas } from './workspace-tools.mjs'

/** 主上下文执行阶段的 turn 上限（runner 构造主 driver 时使用）。 */
export const ARCH_A_MAIN_MAX_TURNS = 24

export class BranchSearchStrategy {
  constructor({ onEvent } = {}) {
    this.name = 'branch-search'
    this.onEvent = onEvent ?? (() => {})
    /** 架构观察数据（报告用）：阶段耗时、分支结果、牺牲语义清单由代码结构决定。 */
    this.phases = []
  }

  event(event) {
    this.onEvent(event)
  }

  /**
   * 由 runWithStrategy 驱动；每次调用推进一个阶段。'executing' 阶段起，本方法
   * 就是基座的标准 turn 循环本身（策略把控制权交还物理规律）。
   * @param {import('./unified-driver.mjs').UnifiedDriver} driver 主 driver
   */
  async driveTurn(driver) {
    if (this.phase === undefined) {
      await this.runEnumerate(driver)
      return true
    }
    if (this.phase === 'enumerated') {
      await this.runInvestigate(driver)
      return true
    }
    if (this.phase === 'investigated') {
      this.runExecute(driver)
      return true
    }
    if (this.phase === 'executing') {
      if (driver.finished) return false
      await driver.step()
      return !driver.finished
    }
    return false // 未知阶段：防御性收尾
  }

  /** ENUMERATE：子会话里枚举 root-cause 假设，只把假设清单带出子会话。 */
  async runEnumerate(driver) {
    const started = Date.now()
    this.event({ type: 'strategy-phase', phase: 'enumerate' })
    const sub = openSubconversation({
      parent: driver,
      parentTools: driver.tools,
      label: 'enumerate',
      context: [
        { role: 'system', content: ENUMERATION_PROMPT },
        { role: 'user', content: TASK_BRIEF },
      ],
      allowedTools: new Set(BRANCH_TOOLSET),
      maxTurns: 8,
    })
    let enumeration = null
    let rawTail = ''
    try {
      await sub.run()
      enumeration = parseHypotheses(sub.finishSummary)
      if (enumeration === null) {
        // 调查轮次用尽但未产出 JSON：补一次收口请求（与 B 组同一协议）。
        sub.context.push({ role: 'user', content: ENUMERATION_REQUEST })
        await sub.step()
        enumeration = parseHypotheses(sub.finishSummary)
      }
    } catch (error) {
      if (error.driverTimeout === true) throw error
      this.event({ type: 'strategy-error', phase: 'enumerate', error: String(error?.message ?? error) })
    }
    rawTail = sub.finishSummary?.slice(-600) ?? ''
    this.hypotheses = enumeration?.hypotheses?.slice(0, BRANCH_CAPS.maxHypotheses) ?? null
    if (this.hypotheses === null || this.hypotheses.length === 0) {
      // 枚举失败：如实落账，strategy 放弃分支搜索，主上下文继续标准执行
      //（对应 B 组 selected=null 的降级路径，语义对齐）。
      this.event({ type: 'strategy-degrade', phase: 'enumerate', reason: 'hypothesis enumeration unparseable', rawTail })
      driver.context.push({ role: 'user', content: '[strategy note] hypothesis enumeration failed; investigate the failure directly and fix it.' })
      this.phase = 'executing'
      this.phases.push({ phase: 'enumerate', ms: Date.now() - started, hypotheses: 0, degraded: true })
      return
    }
    this.phase = 'enumerated'
    this.phases.push({ phase: 'enumerate', ms: Date.now() - started, hypotheses: this.hypotheses.length })
    this.event({ type: 'strategy-hypotheses', hypotheses: this.hypotheses })
  }

  /** INVESTIGATE：每假设一个并行 sub-conversation，独立上下文与报告。 */
  async runInvestigate(driver) {
    const started = Date.now()
    this.event({ type: 'strategy-phase', phase: 'investigate', branches: this.hypotheses.length })
    const investigationTools = toolSchemas().filter((schema) => BRANCH_TOOLSET.includes(schema.function.name))
    const work = this.hypotheses.map(async (hypothesis, index) => {
      const label = `branch-${hypothesis.id}`
      const sub = openSubconversation({
        parent: driver,
        parentTools: driver.tools,
        label,
        context: [
          { role: 'system', content: investigationSystemPrompt(hypothesis) },
          { role: 'user', content: TASK_BRIEF },
        ],
        allowedTools: new Set(BRANCH_TOOLSET),
        maxTurns: BRANCH_CAPS.maxBranchRequests,
      })
      // 并发闸门：最多 branchConcurrency 个分支同时发模型请求。
      await this.acquireSlot(index)
      try {
        await sub.run()
      } catch (error) {
        if (error.driverTimeout === true) throw error
        this.event({ type: 'strategy-error', phase: 'investigate', branch: label, error: String(error?.message ?? error) })
        return { hypothesis_id: hypothesis.id, report: null }
      } finally {
        this.releaseSlot()
      }
      let report = parseReport(sub.finishSummary)
      if (report === null) {
        // 报告缺失：补一次只要求 JSON 的收尾请求（与 B 组同一协议）。
        sub.context.push({ role: 'user', content: REPORT_REQUEST })
        try {
          await sub.step()
          report = parseReport(sub.finishSummary)
        } catch (error) {
          if (error.driverTimeout === true) throw error
        }
      }
      return { hypothesis_id: hypothesis.id, report, rawTail: sub.finishSummary?.slice(-400) }
    })
    const results = await Promise.all(work)
    this.reports = results
    const parsed = results.filter((result) => result.report !== null).map((result) => result.report)
    this.event({ type: 'strategy-reports', reports: parsed, unparseable: results.length - parsed.length })
    this.phases.push({ phase: 'investigate', ms: Date.now() - started, branches: this.hypotheses.length, reportsParsed: parsed.length })
    this.phase = 'investigated'
  }

  /** CONVERGE（确定性）+ EXECUTE 前置：收敛结果与全部报告写入主上下文。 */
  runExecute(driver) {
    const started = Date.now()
    const { selected, reason } = selectHypothesis(this.hypotheses, this.reports.map((result) => result.report))
    this.event({ type: 'strategy-converged', selected: selected?.hypothesis_id ?? null, reason })
    const briefing = [
      '[strategy] Branch-search investigation complete. Full reports follow; the selected hypothesis is decided by the frozen deterministic rule (confirmed > inconclusive, then evidence count).',
      `Selection: ${selected === null ? 'NO hypothesis confirmed or inconclusive — investigate directly' : selected.hypothesis_id}`,
      `Rule trace: ${reason}`,
      ...this.hypotheses.map((hypothesis) => {
        const result = this.reports.find((entry) => entry.hypothesis_id === hypothesis.id)
        const report = result?.report
        return [
          `## ${hypothesis.id}: ${hypothesis.statement}`,
          report === null || report === undefined
            ? 'report: (unparseable/missing — see raw tail)'
            : `verdict: ${report.verdict} (confidence ${report.confidence ?? 'n/a'})\nevidence: ${(report.evidence ?? []).map((item) => `- ${item}`).join('\n') || '- (none)'}\nimplicated: ${(report.implicated_files ?? []).join(', ') || '(none)'}`,
          result?.rawTail !== undefined && (report === null || report === undefined) ? `raw tail: ${result.rawTail}` : '',
        ].filter((line) => line !== '').join('\n')
      }),
      selected === null
        ? 'Fix the test-suite failure now, working from these reports where useful; verify with the test suite before finishing.'
        : `Proceed to fix the confirmed root cause (${selected.hypothesis_id}) so the suite passes per the README spec; verify with the test suite before finishing. Do not re-litigate refuted hypotheses.`,
    ].join('\n')
    driver.context.push({ role: 'user', content: briefing })
    this.phases.push({ phase: 'converge+hand-into-context', ms: Date.now() - started, selected: selected?.hypothesis_id ?? null })
    this.phase = 'executing'
  }

  acquireSlot(index) {
    this.slots = this.slots ?? { active: 0, queue: [] }
    if (this.slots.active < BRANCH_CAPS.branchConcurrency) {
      this.slots.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => this.slots.queue.push(resolve))
  }

  releaseSlot() {
    this.slots.active -= 1
    const next = this.slots.queue.shift()
    if (next !== undefined) this.slots.active += 1
    next?.()
  }
}

/** 解析枚举输出：宽容提取首个 JSON 对象并校验形状。 */
function parseHypotheses(text) {
  const parsed = parseReport(text)
  if (parsed === null || !Array.isArray(parsed.hypotheses) || parsed.hypotheses.length === 0) return null
  const clean = parsed.hypotheses
    .filter((entry) => entry !== null && typeof entry.statement === 'string' && entry.statement.trim() !== '')
    .map((entry, index) => ({
      id: typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id : `h${index + 1}`,
      statement: entry.statement,
      modules: Array.isArray(entry.modules) ? entry.modules : [],
      how_to_confirm: typeof entry.how_to_confirm === 'string' ? entry.how_to_confirm : undefined,
    }))
  return clean.length === 0 ? null : { hypotheses: clean }
}

/** 方案 A 的组装入口：UnifiedDriver + BranchSearchStrategy（经 strategy host 驱动）。 */
export async function runArchitectureA({ driver, strategy }) {
  return runWithStrategy(driver, strategy)
}
