import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { S2CaptureSchema, type GungnirState } from 'gungnir-core'
import type { ReconcileEngine } from './engine.ts'
import type { LedgerDirectory } from './engine.ts'
import type { PassivePlaneRuntime } from './passive-plane.ts'

/**
 * 人侧命令（/ultragoal、/gungnir）与模型侧工具（gungnir_submit_spec / gungnir_plan /
 * gungnir_report）。所有对 DSH 服务的访问走窄结构视图（对齐 0.1.1-rc.2 实测形状，
 * 见 docs/context/dsh-interface.md），缺服务时 fail loud。
 */

export interface AgentView {
  readonly id: string
  followup(message: unknown): unknown
  inject(message: unknown): unknown
}

export interface GoalViewLike {
  readonly id: string
  readonly revision: number
  readonly phase?: string
  readonly activation?: string
}

export interface GoalsView {
  get(agent: AgentView): GoalViewLike | undefined
  create(agent: AgentView, request: { objective: string; maxGoalRounds?: number }): GoalViewLike
  pause(agent: AgentView, ref: { id: string; revision: number }): unknown
  resume(agent: AgentView, ref: { id: string; revision: number }): unknown
  clear(agent: AgentView, ref: { id: string; revision: number }): unknown
}

export interface CommandsView {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler(invocation: { agent: AgentView; rawInput: string }): { kind: 'success' | 'error'; text?: string } | Promise<{ kind: 'success' | 'error'; text?: string }>
  }): () => void
}

export interface ToolsView {
  /** 接收 defineTool 产出的 ToolDefinition；schema 编译由 defineTool 负责（裸 DSL 不是 JSON Schema）。 */
  register(definition: unknown): () => void
}

export interface UserQuestionsView {
  ask(request: { questions: unknown[]; agent: AgentView; signal?: AbortSignal }): Promise<{ [key: string]: unknown }>
}

export interface SurfaceDeps {
  engine: ReconcileEngine
  ledgers: LedgerDirectory
  goals: GoalsView
  userQuestions: UserQuestionsView | null
  /** headless/实验模式：跳过 ask-user，启动者即授权人 */
  autoApproveSpec: boolean
  maxGoalRounds: number
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void
  /** 冷重建并缓存该 agent 的 ledger（engine 事件面全部依赖它先就位） */
  ensureLedger(agentId: string): Promise<unknown>
  /** 被动面模式（三阶段 P1）：'off' = 协议面现役；'s1'/'s1+s2' = 被动面 */
  passive: 'off' | 's1' | 's1+s2' | 'bpar'
  /** 被动面运行时（passive != 'off' 时非 null） */
  passiveRuntime?: PassivePlaneRuntime | null
}

function currentState(deps: SurfaceDeps, agent: AgentView): GungnirState | null {
  const ledger = deps.ledgers.get(agent.id)
  return ledger?.current ?? null
}

function renderStatus(state: GungnirState): string {
  if (state.spec === null) return 'Gungnir: no active spec. Start with /ultragoal <objective>.'
  const lines = [
    `spec ${state.spec.specId} v${state.spec.version} — ${state.spec.objective}`,
    `phase: ${state.phase}  round: ${state.currentRound}  action: ${state.currentAction?.actionId ?? '—'}`,
    `criteria (${state.spec.successCriteria.length}):`,
  ]
  for (const criterion of state.spec.successCriteria) {
    const observed = state.criteria[criterion.id]
    lines.push(`  [${observed?.satisfied ? 'x' : ' '}] ${criterion.id} (${criterion.predicate.kind}/L${criterion.verifierLevel}) last=${observed?.lastOutcome ?? '—'}`)
  }
  lines.push(`roundsNoImprovement=${state.roundsNoImprovement} verdictRuns=${state.verdictRuns} claims=${state.claimsCount}`)
  if (state.blocker !== '') lines.push(`blocker: ${state.blocker}`)
  return lines.join('\n')
}

function renderVerdicts(state: GungnirState): string {
  const lines: string[] = []
  for (const criterion of state.spec?.successCriteria ?? []) {
    const observed = state.criteria[criterion.id]
    if (observed === undefined) continue
    lines.push(`${criterion.id}: last=${String(observed.lastOutcome)} raw=${String(observed.lastRawOutcome)} round=${String(observed.lastVerdictRound)} verdicts=${observed.verdictCount}${observed.lastFailSignature !== null ? ` lastFail=${observed.lastFailSignature.slice(0, 24)}` : ''}`)
  }
  return lines.length > 0 ? lines.join('\n') : 'no verdicts recorded yet'
}

/** /ultragoal 与 /gungnir 命令注册。 */
export function registerCommands(commands: CommandsView, deps: SurfaceDeps): void {
  commands.register({
    name: 'ultragoal',
    description: 'Declare a versioned goal spec and let Gungnir drive it to verified completion (Declare it. Gungnir never misses.)',
    input: { hint: '<objective>  |  --spec <path/to/goalspec.yaml|json>' },
    async handler(invocation) {
      const raw = invocation.rawInput.trim()
      if (raw === '') return { kind: 'error', text: 'usage: /ultragoal <objective>  or  /ultragoal --spec <path>' }
      try {
        if (raw.startsWith('--spec')) {
          const path = raw.slice('--spec'.length).trim()
          const text = await readFile(path, 'utf8')
          const parsed: unknown = path.endsWith('.json') ? JSON.parse(text) : parseYaml(text)
          await deps.ensureLedger(invocation.agent.id)
          const { specId } = await deps.engine.commitSpec(invocation.agent.id, parsed)
          deps.goals.create(invocation.agent, { objective: (parsed as { objective?: string }).objective ?? specId, maxGoalRounds: deps.maxGoalRounds })
          return { kind: 'success', text: `Gungnir: spec ${specId} committed from ${path}. Native goal armed; first round will reconcile.` }
        }
        await invocation.agent.followup({
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Objective from the human: ${raw}`,
                'Draft a GoalSpec for it: a short objective, 1-5 concrete successCriteria (predicates: exit_code | artifact | llm_rubric | human; prefer the lowest verifier level that can prove it; an llm_rubric predicate MUST set subjectPath naming the workspace-relative artifact to judge), optional constraints/nonGoals/assumptions/budget.maxRounds.',
                'Then call the gungnir_submit_spec tool with the complete spec object. Wait for human confirmation through that tool.',
              ].join('\n'),
            },
            { kind: 'plugin', plugin: 'gungnir', form: 'instructions' },
          ],
        })
        return { kind: 'success', text: 'Gungnir: drafting spec — the model will call gungnir_submit_spec for your one-shot confirmation.' }
      } catch (error) {
        deps.log('error', 'ultragoal failed', error)
        return { kind: 'error', text: `Gungnir error: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })

  commands.register({
    name: 'gungnir',
    description: 'Inspect or control the Gungnir reconcile loop: status | verdicts | pause | resume | clear',
    input: { hint: 'status | verdicts | pause | resume | clear' },
    handler(invocation) {
      const verb = invocation.rawInput.trim().split(/\s+/)[0] ?? 'status'
      const state = currentState(deps, invocation.agent)
      const goal = deps.goals.get(invocation.agent)
      try {
        switch (verb) {
          case 'status':
            return { kind: 'success', text: state === null ? 'Gungnir: no active spec.' : `${renderStatus(state)}\nnative goal: ${goal ? `${goal.id} rev${goal.revision} ${goal.phase ?? '?'}/${goal.activation ?? '?'}` : 'none'}` }
          case 'verdicts':
            return { kind: 'success', text: state === null ? 'Gungnir: no active spec.' : renderVerdicts(state) }
          case 'pause':
            if (goal === undefined) return { kind: 'error', text: 'Gungnir: no native goal to pause.' }
            deps.goals.pause(invocation.agent, { id: goal.id, revision: goal.revision })
            return { kind: 'success', text: 'Gungnir: goal paused (rounds stop; ledger history preserved).' }
          case 'resume':
            if (goal === undefined) return { kind: 'error', text: 'Gungnir: no native goal to resume.' }
            deps.goals.resume(invocation.agent, { id: goal.id, revision: goal.revision })
            return { kind: 'success', text: 'Gungnir: goal resumed.' }
          case 'clear':
            if (goal === undefined) return { kind: 'success', text: 'Gungnir: no native goal; durable ledger history is kept.' }
            deps.goals.clear(invocation.agent, { id: goal.id, revision: goal.revision })
            return { kind: 'success', text: 'Gungnir: goal cleared; durable ledger history is kept.' }
          default:
            return { kind: 'error', text: 'usage: /gungnir status | verdicts | pause | resume | clear' }
        }
      } catch (error) {
        deps.log('error', 'gungnir command failed', error)
        return { kind: 'error', text: `Gungnir error: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

/** 模型侧工具注册（claim 永远只是 claim）。被动面模式（P1）下协议工具不注册。 */
export function registerTools(tools: ToolsView, deps: SurfaceDeps): void {
  if (deps.passive !== 'off') {
    if (deps.passive === 's1+s2') {
      registerCaptureTool(tools, deps)
    }
    return
  }
  tools.register(defineTool({
    name: 'gungnir_submit_spec',
    description: 'Submit a drafted GoalSpec for one-shot human confirmation. On approval Gungnir commits it and arms the native goal.',
    parameters: {
      spec: { type: 'object', additionalProperties: true, required: true, description: 'Complete GoalSpec object (specId, version, objective, successCriteria[] each {id, description, predicate{kind,...}, verifierLevel}, constraints, nonGoals, assumptions, budget). predicate kinds: exit_code(L1) | artifact(L2) | llm_rubric(L4, REQUIRES subjectPath naming the artifact to judge) | human(L5)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('gungnir_submit_spec requires an agent context')
      let approved = deps.autoApproveSpec
      let approvalNote = 'auto-approved (autoApproveSpec: launcher consent)'
      if (!approved) {
        if (deps.userQuestions === null) throw new Error('userQuestions service unavailable and autoApproveSpec is off: use /ultragoal --spec <path> or enable autoApproveSpec for headless flows')
        const answer = await deps.userQuestions.ask({
          questions: [
            {
              type: 'confirm',
              label: 'Commit this GoalSpec?',
              description: JSON.stringify(args['spec']).slice(0, 2000),
            },
          ],
          agent,
        })
        approved = Object.values(answer).some((value) => value === true || value === 'yes' || value === 'confirm')
        approvalNote = 'approved by human'
      }
      if (!approved) {
        return { status: 'rejected', message: 'Human did not confirm; revise the spec if asked again.' }
      }
      try {
        await deps.ensureLedger(agent.id)
        const { specId } = await deps.engine.commitSpec(agent.id, args['spec'])
        const spec = args['spec'] as { objective?: string }
        // 模型可能已通过 tool-goal 自建 goal（headless 路径）：已有 goal 则不重复创建
        const existing = deps.goals.get(agent)
        if (existing === undefined) {
          deps.goals.create(agent, { objective: spec.objective ?? specId, maxGoalRounds: deps.maxGoalRounds })
        } else {
          deps.log('info', `native goal already present (${existing.id}); keeping it armed for the committed spec`)
        }
        return { status: 'committed', specId, approval: approvalNote }
      } catch (error) {
        // D4：坏 spec 只回紧凑原因（首条 issue + 路径），不再回 5.6k 字符 Zod dump
        throw compactZodError(error)
      }
    },
  }))

  tools.register(defineTool({
    name: 'gungnir_plan',
    description: 'Submit a rolling-horizon projection. The harness commits the first actionable step as this round\'s single action.',
    parameters: {
      rationale: { type: 'string', required: true, description: 'Why this projection now (esp. after REPLAN)' },
      steps: {
        type: 'array',
        required: true,
        description: 'Ordered steps; the harness commits the first one with unsatisfied targets.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Stable step id, e.g. s1' },
            summary: { type: 'string', required: true, description: 'Imperative one-liner for the committed round' },
            targetsCriteria: { type: 'array', required: true, items: { type: 'string' }, description: 'Success criterion ids this step aims to satisfy' },
            expectedEvidence: { type: 'array', items: { type: 'string' }, description: 'Evidence hints (paths/commands)' },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('gungnir_plan requires an agent context')
      await deps.ensureLedger(agent.id)
      const steps = args['steps'] as Array<{ id: string; summary: string; targetsCriteria: string[]; expectedEvidence?: string[] }>
      const result = await deps.engine.commitPlan(agent.id, steps, String(args['rationale'] ?? ''))
      return { ...result, message: 'Execute the committed action this round, then call gungnir_report.' }
    },
  }))

  tools.register(defineTool({
    name: 'gungnir_report',
    description: 'Report your outcome for the committed action. This is a CLAIM — verdicts come only from harness-verified evidence.',
    parameters: {
      summary: { type: 'string', required: true, description: 'What you did and observed' },
      asserted_outcome: { type: 'string', required: true, description: 'done | partial | failed | blocked' },
      evidence_refs: { type: 'array', items: { type: 'string' }, description: 'evidenceIds you believe support the claim' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('gungnir_report requires an agent context')
      const asserted = args['asserted_outcome']
      if (asserted !== 'done' && asserted !== 'partial' && asserted !== 'failed' && asserted !== 'blocked') {
        throw new Error('asserted_outcome must be one of done|partial|failed|blocked')
      }
      await deps.ensureLedger(agent.id)
      await deps.engine.recordClaim(agent.id, {
        summary: String(args['summary'] ?? ''),
        assertedOutcome: asserted,
        evidenceRefs: Array.isArray(args['evidence_refs']) ? args['evidence_refs'].map(String) : [],
      })
      return { recorded: true, note: 'Claim recorded. The verifier issues verdicts from evidence at round end.' }
    },
  }))
}

/** 紧凑 Zod 错误（D4 修复：不再把 5.6k 字符 schema dump 丢给模型重试）。 */
export function compactZodError(error: unknown): Error {
  const zod = error as { issues?: Array<{ path?: (string | number)[]; message?: string }> }
  if (Array.isArray(zod.issues) && zod.issues.length > 0 && zod.issues[0] !== undefined) {
    const first = zod.issues[0]
    const path = (first.path ?? []).join('.')
    return new Error(`spec schema error at ${path || 'root'}: ${first.message ?? 'invalid'}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * gungnir_capture（S2 一次性轻量捕获，被动面 s1+s2 模式）：
 * 主 Agent 在 session 开头声明一次预期产物 / 验证命令 / 约束；wrapup 时 harness 侧
 * 按此校验（L1/L2 确定性，L4 禁用）。捕获不是协议——只此一次，代价 1 个额外往返。
 */
function registerCaptureTool(tools: ToolsView, deps: SurfaceDeps): void {
  tools.register(defineTool({
    name: 'gungnir_capture',
    description: 'One-shot capture (call exactly once, early): declare what this task must produce and how to verify it. The harness re-checks these at your completion claim.',
    parameters: {
      expectedArtifacts: {
        type: 'array',
        description: 'Artifacts the task must produce (workspace-relative paths). Empty array if none.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            mustExist: { type: 'boolean' },
            contains: { type: 'string', description: 'Required substring in the file content' },
          },
        },
      },
      verifyCommands: {
        type: 'array',
        description: 'Commands whose exit code proves the work (e.g. ["node --test --test-isolation=none"]). Empty array if none.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: { type: 'string', required: true },
            expectedExitCode: { type: 'number' },
          },
        },
      },
      constraints: {
        type: 'object',
        additionalProperties: false,
        description: 'Task constraints the harness must check. Omit if none.',
        properties: {
          noModifyFiles: { type: 'array', items: { type: 'string' }, description: 'Files that must remain untouched (workspace-relative)' },
          noNewDeps: { type: 'boolean', description: 'True if the task forbids adding dependencies' },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('gungnir_capture requires an agent context')
      if (deps.passiveRuntime === undefined || deps.passiveRuntime === null) {
        throw new Error('passive runtime unavailable in this profile')
      }
      const capture = S2CaptureSchema.parse(args)
      await deps.passiveRuntime.capture(agent.id, capture)
      return { captured: true, note: 'Capture recorded. The harness re-checks artifacts/commands at your completion claim.' }
    },
  }))
}
