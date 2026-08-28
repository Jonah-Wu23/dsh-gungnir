/**
 * stage2/metrics.mjs — 预注册指标的操作化提取（口径见 PRE-REGISTRATION.md §4）。
 *
 * 输入：解码后的 session log 事件数组 + runner 计时；输出：一行指标（不含 token 估计，
 * token 由 run-groups 末尾批量调用官方 tokenizer 补齐）。
 */

const DENIAL_MARKERS = ['denied', 'EPERM', 'WEB_BLOCKED']

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks.map(block => (block.type === 'text' ? block.text : '')).join('')
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
      const isError = data.message?.content?.some(block => block.type === 'tool-result' && block.isError === true) ?? false
      const text = textOfBlocks(data.message?.content ?? [])
      const callId = data.message?.source?.callId
      const name = callNameByCallId.get(callId)
      if (isError) {
        metrics.validationFailures++
        if (name !== undefined) failedNames.add(name)
      } else if (name !== undefined && failedNames.has(name)) {
        recoveredNames.add(name)
      }
      if (DENIAL_MARKERS.some(marker => text.includes(marker))) metrics.instructionViolations++
    }
  }
  metrics.recoveryCount = recoveredNames.size
  return metrics
}
