/**
 * branch-protocol.mjs — Branch Search 的算法语义（A/B 共用，公平性保证）。
 *
 * EXPERIMENT.md §3：A 和 B 的唯一差异是"Branch Search 住在哪里"。为保证可比性，
 * 分支调查的提示词、工具面、轮次上限、报告 schema、收敛规则在此**只定义一次**，
 * A（BranchSearchStrategy）与 B（BranchSearchLoop）都消费本模块，禁止各自再写
 * 一套语义。本模块属于实验协议层，不属于任何一方的架构代码。
 *
 * 收敛规则（确定性，冻结）：
 *   confirmed > inconclusive > refuted；同级按 evidence 条数降序，再按假设序号升序。
 *   无 viable 假设时 selected = null（packet/summary 如实记录，不编造）。
 */

export const BRANCH_TOOLSET = ['read_file', 'list_dir', 'run_command']

export const BRANCH_CAPS = {
  maxHypotheses: 4,
  maxBranchRequests: 10,
  branchConcurrency: 3,
  investigationMaxTokens: 4096,
}

export const ENUMERATION_PROMPT = [
  'You are the hypothesis-enumeration stage of a branch-search investigation.',
  'The repository in your workspace has a failing test suite. Read the tests, the README (authoritative spec) and any relevant source, then enumerate the DISTINCT plausible root causes.',
  'Rules:',
  '- Exactly one JSON object, no prose outside it.',
  '- Produce 3 to 4 hypotheses. Each must be a concrete, testable, distinct mechanism (not a restating of the symptom).',
  '- Do not fix anything. Enumeration only.',
  'Format: {"hypotheses": [{"id": "h1", "statement": "...", "modules": ["src/..."], "how_to_confirm": "..."}]}',
].join('\n')

export function investigationSystemPrompt(hypothesis) {
  return [
    'You are ONE investigation branch inside a branch-search debugging session. You investigate exactly one hypothesized root cause, independently of other branches.',
    '',
    `Your hypothesis: ${hypothesis.id} — ${hypothesis.statement}`,
    hypothesis.how_to_confirm !== undefined ? `Suggested confirmation path: ${hypothesis.how_to_confirm}` : '',
    '',
    'Rules:',
    '- Investigate by reading code and, if useful, running read-only commands (node scripts/tests) from the workspace. Do NOT edit any file.',
    '- Stay strictly inside the workspace.',
    '- Judge the hypothesis on evidence you actually observed, not on plausibility.',
    '- End by replying with exactly one JSON object and nothing else:',
    '{"hypothesis_id":"<id>","verdict":"confirmed|refuted|inconclusive","evidence":["<observed fact>"],"implicated_files":["src/..."],"confidence":0.0-1.0}',
    '- evidence must cite concrete observations (file, line, command output); "I did not find X" is inconclusive, not refuted, unless you have positive disproof.',
  ].filter((line) => line !== '').join('\n')
}

export const REPORT_REQUEST = 'Now emit your final investigation report as exactly one JSON object per the schema. No other text.'

/** 枚举收口请求（调查轮次用尽但未产出 JSON 时补一次收口；A/B 同文同协议）。 */
export const ENUMERATION_REQUEST = 'Now emit exactly the JSON object {"hypotheses": [...]} per the format specified earlier. No other text.'

/** 阶段会话共用的任务简述（A/B 同文；调查只读，不修码）。 */
export const TASK_BRIEF = 'Goal: the repository in your workspace (current directory) has a failing test suite. README.md is the authoritative spec. Investigation only: do not edit files.'

/** 确定性收敛（对 A/B 同一字节级实现）。reports: [{hypothesis_id, verdict, evidence[], ...}] */
export function selectHypothesis(hypotheses, reports) {
  const rank = { confirmed: 0, inconclusive: 1, refuted: 2 }
  const viable = reports
    .filter((report) => report !== null && report.verdict !== undefined && rank[report.verdict] !== undefined && rank[report.verdict] < 2)
    .sort((a, b) => {
      const byRank = rank[a.verdict] - rank[b.verdict]
      if (byRank !== 0) return byRank
      const byEvidence = (b.evidence?.length ?? 0) - (a.evidence?.length ?? 0)
      if (byEvidence !== 0) return byEvidence
      return (hypotheses.findIndex((h) => h.id === a.hypothesis_id) ?? 0) - (hypotheses.findIndex((h) => h.id === b.hypothesis_id) ?? 0)
    })
  if (viable.length === 0) return { selected: null, reason: 'no hypothesis confirmed or inconclusive after investigation' }
  return { selected: viable[0], reason: `rank confirmed>inconclusive, then evidence count; selected ${viable[0].hypothesis_id} (${viable[0].verdict}, ${viable[0].evidence?.length ?? 0} evidence items)` }
}

/** 解析分支报告 JSON（宽容提取首个平衡 JSON 对象；失败返回 null 并由调用方落账）。 */
export function parseReport(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}
