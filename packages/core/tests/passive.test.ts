import { describe, expect, it } from 'vitest'
import {
  assessS1,
  isEscalationDenial,
  assessS2,
  assertNoL4,
  buildMafMessage,
  emptyPassivePlane,
  hasTestFailureMarkers,
  invariantsFromToolEvent,
  isCompletionCallToolError,
  isDeniedText,
  isInsideWorkspace,
  isTestRunText,
  observeToolEvent,
  recordCapture,
  recordCompletionClaim,
  type PassivePlaneState,
  type S2VerifyContext,
  type ToolEventView,
} from '../src/passive.ts'
import { emptyEscalationCounters, observeEscalationEvent } from '../src/escalation.ts'
import { parseGungnirEvent, makeEvent } from '../src/schema/events.ts'
import { foldEvents } from '../src/fold.ts'
import { S2CaptureSchema } from '../src/schema/passive.ts'
import { parseGoalSpec } from '../src/schema/spec.ts'
import type { GoalSpec } from '../src/schema/spec.ts'
import type { S2Capture } from '../src/schema/passive.ts'

const WS = 'C:/work/run-ws'

function callView(overrides: Partial<ToolEventView> & { name: string; callId: string }): ToolEventView {
  return { type: 'tool/call', turn: 1, step: 1, args: {}, ...overrides }
}

function resultView(overrides: Partial<ToolEventView> & { callId: string; text: string }): ToolEventView {
  return { type: 'tool/result', turn: 1, step: 1, name: 'pwsh', isError: false, ...overrides }
}

describe('S1 不变量派生（invariantsFromToolEvent）', () => {
  it('tool-error：isError=true → error 不变量', () => {
    const obs = invariantsFromToolEvent(resultView({ callId: 'c1', text: 'boom', isError: true, name: 'pwsh' }), WS)
    expect(obs.map((o) => o.invariantId)).toContain('tool-error')
    expect(obs.find((o) => o.invariantId === 'tool-error')?.severity).toBe('error')
  })

  it('sandbox-denied：文本含 denied/EPERM 标记 → error 不变量', () => {
    for (const marker of ['denied', 'EPERM', 'WEB_BLOCKED']) {
      const obs = invariantsFromToolEvent(resultView({ callId: 'c2', text: `Error: ${marker} by sandbox` }), WS)
      expect(obs.map((o) => o.invariantId)).toContain('sandbox-denied')
    }
    expect(isDeniedText('all fine')).toBe(false)
  })

  it('test-failure：测试运行失败标记 → warning 不变量；纯通过文本不触发', () => {
    const failText = '✖ fmt.test.js (3.8ms)\nℹ fail 1'
    const obs = invariantsFromToolEvent(resultView({ callId: 'c3', text: failText }), WS)
    expect(obs.map((o) => o.invariantId)).toContain('test-failure')
    expect(hasTestFailureMarkers('✔ passes\nℹ pass 2')).toBe(false)
    expect(isTestRunText('✔ passes')).toBe(true)
  })

  it('write-outside-workspace：写类工具路径越界 → error 不变量；区内不触发', () => {
    const outside = invariantsFromToolEvent(
      callView({ name: 'write', callId: 'c4', args: { file_path: 'C:/Windows/tmp.txt' } }),
      WS,
    )
    expect(outside.map((o) => o.invariantId)).toContain('write-outside-workspace')
    const inside = invariantsFromToolEvent(
      callView({ name: 'write', callId: 'c5', args: { file_path: 'C:/work/run-ws/out/a.txt' } }),
      WS,
    )
    expect(inside).toEqual([])
    // 非写类工具不检查
    const read = invariantsFromToolEvent(callView({ name: 'read', callId: 'c6', args: { file_path: 'C:/Windows/x' } }), WS)
    expect(read).toEqual([])
  })

  it('isInsideWorkspace：Windows 大小写/分隔符归一；相对路径解析；.. 逃逸识别', () => {
    expect(isInsideWorkspace('C:\\Work\\Run-WS\\out\\a.txt', 'C:/work/run-ws')).toBe(true)
    expect(isInsideWorkspace('C:/work/run-ws', 'C:/work/run-ws')).toBe(true)
    expect(isInsideWorkspace('C:/work/run-ws2', 'C:/work/run-ws')).toBe(false)
    // 相对路径按 workspace 相对解析（写类工具常用相对路径，误判越界是 P1 假阳性根因）
    expect(isInsideWorkspace('out/part1.txt', 'C:/work/run-ws')).toBe(true)
    expect(isInsideWorkspace('out\\kv.json', 'C:/work/run-ws')).toBe(true)
    // 相对路径 .. 逃逸 workspace → 越界
    expect(isInsideWorkspace('../outside.txt', 'C:/work/run-ws')).toBe(false)
    expect(isInsideWorkspace('out/../../outside.txt', 'C:/work/run-ws')).toBe(false)
    expect(isInsideWorkspace('out/../inner.txt', 'C:/work/run-ws')).toBe(true)
  })

  it('M2：文本判读仅限命令类工具——read/grep 结果含 denied/Error 字面量不触发不变量', () => {
    const readDenied = invariantsFromToolEvent(resultView({ callId: 'c9', text: "const SANDBOX_DENIAL_MARKERS = ['denied', 'EPERM']", name: 'read' }), WS)
    expect(readDenied.map((o) => o.invariantId)).not.toContain('sandbox-denied')
    expect(readDenied.map((o) => o.invariantId)).not.toContain('test-failure')
    const grepFail = invariantsFromToolEvent(resultView({ callId: 'c10', text: 'Error: this is file content', name: 'grep' }), WS)
    expect(grepFail.map((o) => o.invariantId)).not.toContain('test-failure')
    // 命令类工具照常判读
    const pwshDenied = invariantsFromToolEvent(resultView({ callId: 'c11', text: 'Error: denied by sandbox', name: 'pwsh' }), WS)
    expect(pwshDenied.map((o) => o.invariantId)).toContain('sandbox-denied')
  })

  it('write-outside-workspace：相对路径写入不触发；绝对越界路径触发', () => {
    const rel = invariantsFromToolEvent(callView({ name: 'write', callId: 'c7', args: { file_path: 'out/a.txt' } }), WS)
    expect(rel).toEqual([])
    const rel2 = invariantsFromToolEvent(resultView({ callId: 'c8', text: 'ok', name: 'write' }), WS)
    // resultView 无 args → 无路径 → 不触发
    expect(rel2).toEqual([])
  })
})

describe('被动面状态机（observeToolEvent / assessS1）', () => {
  it('test-failure 时间序翻转：fail 后被 pass 覆盖 → 无冲突', () => {
    let state = emptyPassivePlane()
    const fail = resultView({ callId: 'a', text: '✖ fails\nℹ fail 1' })
    const pass = resultView({ callId: 'b', text: '✔ passes\nℹ pass 2' })
    state = observeToolEvent(state, fail, WS).state
    expect(state.lastTestRunOutcome).toBe('fail')
    expect(assessS1(state).map((c) => c.kind)).toContain('test-failure')
    state = observeToolEvent(state, pass, WS).state
    expect(state.lastTestRunOutcome).toBe('pass')
    expect(assessS1(state).map((c) => c.kind)).not.toContain('test-failure')
  })

  it('fail 后未再跑测试 → wrapup 冲突', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, resultView({ callId: 'a', text: '✖ fails' }), WS).state
    state = observeToolEvent(state, resultView({ callId: 'b', text: 'plain output' }), WS).state
    expect(assessS1(state).map((c) => c.kind)).toContain('test-failure')
  })

  it('sandbox-denied/tool-error 恢复语义：后续干净结果清除；最近仍处错误态才冲突', () => {
    // 拒绝后恢复 → 不冲突
    let state = emptyPassivePlane()
    state = observeToolEvent(state, resultView({ callId: 'a', text: 'Error: denied by sandbox', isError: true }), WS).state
    state = observeToolEvent(state, resultView({ callId: 'b', text: 'later clean output' }), WS).state
    const recovered = assessS1(state).map((c) => c.kind)
    expect(recovered).not.toContain('sandbox-denied')
    expect(recovered).not.toContain('tool-error')
    // 最后一条仍是拒绝 → 冲突
    state = observeToolEvent(state, resultView({ callId: 'c', text: 'Error: EPERM again' }), WS).state
    expect(assessS1(state).map((c) => c.kind)).toContain('sandbox-denied')
  })

  it('测试运行判读优先于 isError：失败的测试运行（isError=true）记 fail 而非 tool-error', () => {
    let state = emptyPassivePlane()
    // 失败的测试运行同时 isError：应记 lastTestRunOutcome=fail（而非 lastProblem=tool-error）
    state = observeToolEvent(state, resultView({ callId: 'a', text: '✖ fails\nℹ fail 1', isError: true }), WS).state
    expect(state.lastTestRunOutcome).toBe('fail')
    expect(state.lastProblem).toBeNull()
    expect(assessS1(state).map((c) => c.kind)).toContain('test-failure')
  })

  it('干净 session（无失败、无越界）→ 无冲突', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, callView({ name: 'write', callId: 'a', args: { file_path: `${WS}/out/a.txt` } }), WS).state
    state = observeToolEvent(state, resultView({ callId: 'b', text: 'ok' }), WS).state
    expect(assessS1(state)).toEqual([])
  })
})

describe('S2 捕获校验（assessS2）', () => {
  function ctx(overrides: Partial<S2VerifyContext> = {}): S2VerifyContext {
    return {
      runCommand: async () => ({ exitCode: 0 }),
      readFile: async (path) => (path === 'out/a.txt' ? 'ALPHA' : null),
      now: () => 0,
      ...overrides,
    }
  }

  function capture(input: Parameters<typeof S2CaptureSchema.parse>[0]): S2Capture {
    return S2CaptureSchema.parse(input)
  }

  it('artifact 缺失 → artifact-missing 冲突', async () => {
    let state = emptyPassivePlane()
    state = recordCapture(state, capture({ expectedArtifacts: [{ path: 'out/missing.txt' }] }), {})
    const conflicts = await assessS2(state, ctx())
    expect(conflicts.map((c) => c.kind)).toContain('artifact-missing')
  })

  it('verifyCommand 非 0 退出 → verify-command-failed 冲突', async () => {
    let state = emptyPassivePlane()
    state = recordCapture(state, capture({ verifyCommands: [{ command: 'node --test' }] }), {})
    const conflicts = await assessS2(state, ctx({ runCommand: async () => ({ exitCode: 1 }) }))
    expect(conflicts.map((c) => c.kind)).toContain('verify-command-failed')
  })

  it('noModifyFiles 内容变化 → file-modified 冲突；未变不冲突', async () => {
    let state = emptyPassivePlane()
    state = recordCapture(state, capture({ constraints: { noModifyFiles: ['config.js'] } }), { 'config.js': 'LOCKED' })
    const changed = await assessS2(state, ctx({ readFile: async () => 'TAMPERED' }))
    expect(changed.map((c) => c.kind)).toContain('file-modified')
    const unchanged = await assessS2(state, ctx({ readFile: async () => 'LOCKED' }))
    expect(unchanged).toEqual([])
  })

  it('noNewDeps：依赖清单变化 → new-deps 冲突', async () => {
    let state = emptyPassivePlane()
    state = recordCapture(state, capture({ constraints: { noNewDeps: true } }), { 'package.json': '{"deps":{}}' })
    const conflicts = await assessS2(state, ctx({ readFile: async () => '{"deps":{"evil":"1.0.0"}}' }))
    expect(conflicts.map((c) => c.kind)).toContain('new-deps')
  })

  it('M1：S2 verifyCommand 被沙箱拒绝（blocked）→ verify-command-failed 冲突，不静默', async () => {
    let state = emptyPassivePlane()
    state = recordCapture(state, capture({ verifyCommands: [{ command: 'node --test' }] }), {})
    const conflicts = await assessS2(state, ctx({ runCommand: async () => ({ exitCode: -1, blocked: true }) }))
    expect(conflicts.map((c) => c.kind)).toContain('verify-command-failed')
    expect(conflicts.find((c) => c.kind === 'verify-command-failed')?.detail).toContain('blocked by the sandbox')
  })
})

describe('MAF 消息（AP-6）', () => {
  it('只含任务层事实，无控制面内部概念', () => {
    const message = buildMafMessage([
      { kind: 'test-failure', ref: 'call:1', detail: 'the most recent test run failed' },
      { kind: 'artifact-missing', ref: 'out/c.txt', detail: 'expected artifact out/c.txt is missing' },
    ])
    expect(message).toContain('test run failed')
    expect(message).toContain('out/c.txt')
    for (const forbidden of ['criterion', 'round', 'spec', 'ledger', 'verifier', 'reconciler', 'GoalSpec']) {
      expect(message.toLowerCase()).not.toContain(forbidden)
    }
  })
})

describe('L4 禁用守卫（D1）', () => {
  function specWithLevels(levels: number[]): GoalSpec {
    return parseGoalSpec({
      specId: 's',
      version: 1,
      objective: 'o',
      successCriteria: levels.map((level, index) => ({
        id: `c${index}`,
        description: `c${index}`,
        verifierLevel: level,
        predicate:
          level === 1
            ? { kind: 'exit_code', command: 'node --test' }
            : level === 4
              ? { kind: 'llm_rubric', rubric: 'r', subjectPath: 'out/a.txt' }
              : { kind: 'artifact', path: 'out/a.txt' },
      })),
    })
  }

  it('含 L4 判据 → 抛错并点名', () => {
    expect(() => assertNoL4(specWithLevels([1, 4]))).toThrow(/L4/)
    expect(() => assertNoL4(specWithLevels([1, 2]))).not.toThrow()
  })
})

describe('被动事件 schema 与 fold（advisory no-op）', () => {
  it('被动事件经 parseGungnirEvent 通过并 fold 为 no-op', () => {
    const invariant = makeEvent(
      {
        type: 'gungnir/invariant',
        invariantId: 'test-failure',
        severity: 'warning',
        turn: 1,
        step: 2,
        ref: 'call:1',
        detail: 'x',
      },
      1000,
    )
    const parsed = parseGungnirEvent(invariant)
    expect(parsed.type).toBe('gungnir/invariant')
    const assessment = makeEvent(
      { type: 'gungnir/assessment', outcome: 'intervene', turn: 1, step: 3, conflicts: [{ kind: 'tool-error', ref: 'c', detail: 'd' }] },
      1001,
    )
    const intervention = makeEvent(
      { type: 'gungnir/intervention', turn: 1, step: 3, conflicts: [{ kind: 'tool-error', ref: 'c', detail: 'd' }], feedback: 'f' },
      1002,
    )
    const state = foldEvents([invariant, assessment, intervention])
    expect(state.eventsFolded).toBe(3)
    expect(state.lastEventTs).toBe(1002)
    // 被动事件不影响 goal 状态机
    expect(state.spec).toBeNull()
    expect(state.phase).toBeNull()
  })

  it('recordCompletionClaim 计数', () => {
    let state: PassivePlaneState = emptyPassivePlane()
    state = recordCompletionClaim(state)
    state = recordCompletionClaim(state)
    expect(state.completionClaims).toBe(2)
  })
})

describe('S1 完成调用豁免（BPAR v0.1，ADR-0022）', () => {
  /** P2 E2-gpt-H1-a 原案：update_goal(action="complete") 误传 edit 专属参数 → 工具报错。 */
  const malformedComplete = (callId: string): ToolEventView =>
    resultView({
      callId,
      name: 'update_goal',
      text: 'Error: objective and max_goal_rounds are valid only with action edit',
      isError: true,
      args: { action: 'complete' },
    })

  it('完成声明调用自身报错 → wrapup 抑制 tool-error 冲突（零拦截）；无上下文则照常拦', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, malformedComplete('call-complete-1'), WS).state
    expect(state.lastProblem).toBe('tool-error')
    expect(state.lastErrorTool).toBe('update_goal')
    expect(state.lastErrorCallId).toBe('call-complete-1')
    expect(state.lastErrorAction).toBe('complete')
    expect(isCompletionCallToolError(state, 'call-complete-1')).toBe(true)
    // wrapup 在同一调用上触发（报错调用 == 完成调用）→ 豁免
    expect(assessS1(state, { completionCallId: 'call-complete-1' })).toEqual([])
    // 旧栈语义（无豁免上下文）：仍视为冲突——豁免是新增路径，不吞既有行为
    expect(assessS1(state).map((c) => c.kind)).toContain('tool-error')
  })

  it('报错调用为其他工具且其后无干净结果消化 → 仍拦（豁免不覆盖）', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, resultView({ callId: 'call-pwsh', name: 'pwsh', text: 'Error: boom', isError: true }), WS).state
    expect(state.lastProblem).toBe('tool-error')
    expect(state.lastErrorTool).toBe('pwsh')
    expect(assessS1(state, { completionCallId: 'call-complete-2' }).map((c) => c.kind)).toContain('tool-error')
  })

  it('update_goal 非完成 action（edit）报错 → 仍拦（action 字段判据）', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, resultView({ callId: 'call-edit', name: 'update_goal', text: 'Error: x', isError: true, args: { action: 'edit' } }), WS).state
    expect(assessS1(state, { completionCallId: 'call-edit' }).map((c) => c.kind)).toContain('tool-error')
  })

  it('完成调用报错后插入其他工具报错 → 后续 wrapup 仍拦（时序判据：最近报错非完成调用）', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, malformedComplete('call-complete-1'), WS).state
    state = observeToolEvent(state, resultView({ callId: 'call-pwsh', name: 'pwsh', text: 'Error: boom', isError: true }), WS).state
    expect(state.lastErrorCallId).toBe('call-pwsh')
    expect(assessS1(state, { completionCallId: 'call-complete-1' }).map((c) => c.kind)).toContain('tool-error')
  })

  it('sandbox-denied 不豁免（三个不变量语义不动）', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, resultView({ callId: 'call-pwsh', name: 'pwsh', text: 'Error: denied by sandbox', isError: true }), WS).state
    expect(state.lastProblem).toBe('sandbox-denied')
    expect(assessS1(state, { completionCallId: 'call-complete-9' }).map((c) => c.kind)).toContain('sandbox-denied')
  })

  it('干净结果清除错误态 → 豁免上下文不适用、无冲突（恢复语义不变）', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, malformedComplete('call-complete-1'), WS).state
    state = observeToolEvent(state, resultView({ callId: 'clean', name: 'pwsh', text: 'ok' }), WS).state
    expect(state.lastProblem).toBeNull()
    expect(state.lastErrorCallId).toBeNull()
    expect(assessS1(state, { completionCallId: 'call-complete-1' })).toEqual([])
  })

  it('豁免只抑制 tool-error，其他冲突（test-failure）照常拦', () => {
    let state = emptyPassivePlane()
    state = observeToolEvent(state, resultView({ callId: 'tf', name: 'pwsh', text: '✖ fails\nℹ fail 1' }), WS).state
    state = observeToolEvent(state, malformedComplete('call-complete-1'), WS).state
    const conflicts = assessS1(state, { completionCallId: 'call-complete-1' })
    expect(conflicts.map((c) => c.kind)).not.toContain('tool-error')
    expect(conflicts.map((c) => c.kind)).toContain('test-failure')
  })

  it('重复 malformed 完成调用：每次 wrapup 都豁免，但 SIG-2 同签名连续 ≥3 仍触发（安全兜底）', () => {
    let state = emptyPassivePlane()
    let counters = emptyEscalationCounters()
    const signals: string[] = []
    for (let i = 1; i <= 3; i++) {
      const event = malformedComplete(`call-malformed-${i}`)
      state = observeToolEvent(state, event, WS).state
      // 豁免：单发不拦（修复目标）
      expect(assessS1(state, { completionCallId: `call-malformed-${i}` })).toEqual([])
      const r = observeEscalationEvent(counters, { type: 'tool/result', name: event.name, text: event.text ?? '', isError: event.isError === true })
      counters = r.counters
      signals.push(...r.signals.map((s) => s.signal))
    }
    // SIG-2 兜底：模型若反复 malformed 完成调用，仍会被重复失败签名路径提醒
    expect(counters.consecutiveErrors).toBe(3)
    expect(signals).toContain('sig-2')
  })
})

describe('S1 沙箱升级被拒（M5 修复：EPERM 同类环境事实不误报）', () => {
  it('isEscalationDenial 识别升级被拒文本', () => {
    expect(isEscalationDenial('Error: sandbox escalation to "workspace-write" is not strictly wider than this call\'s current "workspace-write" mode')).toBe(true)
    expect(isEscalationDenial('denied by policy')).toBe(false)
    expect(isEscalationDenial('node --test passed')).toBe(false)
  })

  it('以升级被拒收尾的会话不产生 tool-error 冲突', () => {
    const events = [
      { type: 'tool/result', turn: 0, step: 0, name: 'pwsh', callId: 'c1', text: 'node --test passed', isError: false },
      { type: 'tool/result', turn: 0, step: 1, name: 'pwsh', callId: 'c2', text: 'Error: sandbox escalation to "workspace-write" is not strictly wider than this call\'s current "workspace-write" mode', isError: true },
    ]
    let state = emptyPassivePlane()
    for (const event of events) {
      state = observeToolEvent(state, event as never, 'C:\ws').state
    }
    expect(assessS1(state)).toEqual([])
  })
})

describe('S1 升级被拒变体（approval 通道缺失）', () => {
  it('识别 "requires approval, no approval channel" 变体', () => {
    expect(isEscalationDenial('Error: sandbox escalation to "danger-full-access" requires approval, but no approval channel is available')).toBe(true)
  })
})
