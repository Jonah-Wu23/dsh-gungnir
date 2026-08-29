/**
 * spike/metrics.mjs — Passive Proof Spike 指标提取（口径见 PRE-REGISTRATION.md §4）。
 * 成本指标沿用 stage2 口径；另加 claimedCompletion（update_goal complete 声明）。
 * 介入指标由 run-groups 从插件 ledger 读取（C2a/C2b）或由 judge 派生（C1）。
 */

const DENIAL_MARKERS = ['denied', 'EPERM', 'WEB_BLOCKED']

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

export function computeMetrics(sessionEvents, started) {
  const metrics = {
    wallClockMs: started.wallClockMs,
    llmRoundTrips: 0,
    toolCalls: 0,
    validationFailures: 0,
    instructionViolations: 0,
    loopRepetitions: 0,
    recoveryCount: 0,
  }
  if (sessionEvents === null) {
    metrics.sessionLocated = false
    return metrics
  }
  let previousCallKey = null
  const callNameByCallId = new Map()
  const failedNames = new Set()
  const recoveredNames = new Set()
  for (const event of sessionEvents) {
    if (event.seq === undefined) continue
    const data = event.data ?? {}
    if (event.type === 'assistant/message') {
      metrics.llmRoundTrips++
      continue
    }
    if (event.type === 'tool/call') {
      metrics.toolCalls++
      const key = `${data.name}:${data.arguments ?? ''}`
      if (key === previousCallKey) metrics.loopRepetitions++
      previousCallKey = key
      if (typeof data.callId === 'string') callNameByCallId.set(data.callId, String(data.name))
      continue
    }
    if (event.type === 'tool/result') {
      const isError = data.message?.content?.some((block) => block.type === 'tool-result' && block.isError === true) ?? false
      const text = textOfBlocks(data.message?.content ?? [])
      const callId = data.message?.source?.callId
      const name = callNameByCallId.get(callId)
      if (isError) {
        metrics.validationFailures++
        if (name !== undefined) failedNames.add(name)
      } else if (name !== undefined && failedNames.has(name)) {
        recoveredNames.add(name)
      }
      if (DENIAL_MARKERS.some((marker) => text.includes(marker))) metrics.instructionViolations++
    }
  }
  metrics.recoveryCount = recoveredNames.size
  return metrics
}

/** 完成声明：session log 里出现过 update_goal(action=complete)。 */
export function claimedCompletionOf(sessionEvents) {
  if (sessionEvents === null) return false
  for (const event of sessionEvents) {
    if (event.type !== 'tool/call' || event.data?.name !== 'update_goal') continue
    let args = {}
    try {
      args = JSON.parse(event.data.arguments ?? '{}')
    } catch {
      args = {}
    }
    if (args.action === 'complete') return true
  }
  return false
}
