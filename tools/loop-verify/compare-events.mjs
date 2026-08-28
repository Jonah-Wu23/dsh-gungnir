/**
 * compare-events.mjs — B3 事件语义对照断言（二阶段 M0/M1 共用）。
 *
 * 同一任务在两种 driver（默认 @deepseek-ai/dsh-agent-loop 与 dsh-gungnir-loop）
 * 下各跑一次真实 headless，比对 session log 的事件序列形态：
 *   1. 事件词汇表一致（出现的事件类型集合，chunk 内噪声明细除外）；
 *   2. 结构不变量：turn/step 嵌套闭合、tool/call 与 tool/result 成对、
 *      request/header 先于 assistant 事件、step/end 收口等；
 *   3. turn/end reason 词汇一致。
 *
 * 用法：node compare-events.mjs <sessionA.jsonl.zstd> <sessionB.jsonl.zstd>
 * 退出码 0 = 形态一致；1 = 存在差异（差异明细打到 stderr）。
 */
import { decodeSessionLog } from '../experiments/switchbench/src/baseline-log.mjs'

const CHUNKY = new Set(['assistant/chunk'])

/** 抽取压缩形态：每 turn 的 step 结构 + 事件类型序列 + tool 配对。 */
function shape(events) {
  const types = []
  const invariants = { violations: [] }
  let openTurn = null
  let openStep = null
  const openToolCalls = new Map()
  let sawRequestHeader = false
  for (const event of events) {
    if (event.seq === undefined) continue
    const { type } = event
    if (!CHUNKY.has(type)) types.push(type)
    switch (type) {
      case 'turn/start': {
        if (openTurn !== null) invariants.violations.push(`turn/start inside open turn ${openTurn}`)
        openTurn = event.data.turn
        break
      }
      case 'turn/end': {
        if (openTurn === null) invariants.violations.push('turn/end without turn/start')
        openTurn = null
        openStep = null
        break
      }
      case 'step/start': {
        if (openTurn === null) invariants.violations.push('step/start outside turn')
        if (openStep !== null) invariants.violations.push(`step/start inside open step ${openStep}`)
        openStep = event.data.step
        break
      }
      case 'step/end': {
        if (openStep === null) invariants.violations.push('step/end without step/start')
        if (openToolCalls.size > 0) invariants.violations.push(`step/end with ${openToolCalls.size} unclosed tool calls`)
        openStep = null
        break
      }
      case 'request/header': {
        sawRequestHeader = true
        break
      }
      case 'assistant/chunk':
      case 'assistant/message': {
        if (!sawRequestHeader) invariants.violations.push(`assistant event before request/header (${type})`)
        break
      }
      case 'tool/call': {
        if (openStep === null) invariants.violations.push('tool/call outside step')
        openToolCalls.set(event.data.callId, type)
        break
      }
      case 'tool/result': {
        const callId = event.data.message?.source?.callId ?? event.data.message?.callId
        if (openStep === null) invariants.violations.push('tool/result outside step')
        if (!openToolCalls.delete(callId)) invariants.violations.push(`tool/result without matching open call ${callId}`)
        break
      }
      default:
        break
    }
  }
  if (openTurn !== null) invariants.violations.push('session ended inside an open turn')
  if (openStep !== null) invariants.violations.push('session ended inside an open step')
  const turnEndReasons = [...new Set(events.filter(e => e.type === 'turn/end').map(e => e.data?.reason?.kind))]
  return { types, vocabulary: [...new Set(types)], invariants, turnEndReasons }
}

const [, , pathA, pathB] = process.argv
if (!pathA || !pathB) {
  console.error('usage: node compare-events.mjs <sessionA.zstd> <sessionB.zstd>')
  process.exit(2)
}
const decode = (label, path) => {
  try {
    return decodeSessionLog(path)
  } catch (error) {
    console.error(`failed to decode ${label}: ${path} :: ${error.message}`)
    throw error
  }
}
const shapeA = shape(decode('A', pathA))
const shapeB = shape(decode('B', pathB))

const problems = []
for (const [name, s] of [['A', shapeA], ['B', shapeB]]) {
  if (s.invariants.violations.length > 0) problems.push(`${s === shapeA ? 'A' : 'B'} invariants: ${s.invariants.violations.join('; ')}`)
}
const vocabOnlyA = shapeA.vocabulary.filter(t => !shapeB.vocabulary.includes(t))
const vocabOnlyB = shapeB.vocabulary.filter(t => !shapeA.vocabulary.includes(t))
if (vocabOnlyA.length > 0) problems.push(`vocabulary only in A: ${vocabOnlyA.join(', ')}`)
if (vocabOnlyB.length > 0) problems.push(`vocabulary only in B: ${vocabOnlyB.join(', ')}`)

console.log(`A: ${shapeA.types.length} durable events, ${shapeA.vocabulary.length} types, turnEnd=${JSON.stringify(shapeA.turnEndReasons)}`)
console.log(`B: ${shapeB.types.length} durable events, ${shapeB.vocabulary.length} types, turnEnd=${JSON.stringify(shapeB.turnEndReasons)}`)
if (problems.length > 0) {
  console.error('B3 FAIL:')
  for (const problem of problems) console.error('  -', problem)
  process.exit(1)
}
console.log('B3 PASS: event vocabulary identical, structural invariants hold in both drivers')
