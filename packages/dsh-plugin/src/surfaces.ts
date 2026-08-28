import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import type { GungnirState } from '@gungnir/core'
import type { ReconcileEngine } from './engine.ts'
import type { LedgerDirectory } from './engine.ts'

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
  register(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: Record<string, unknown>
      render(args: Record<string, unknown>, value: unknown): Array<{ type: string; text?: string }>
    }
    execute(args: Record<string, unknown>, exec: { agent?: AgentView }): Promise<unknown>
  }): () => void
}

export interface UserQuestionsView {
  ask(request: { questions: unknown[]; agent: AgentView; signal?: AbortSignal }): Promise<{ [key: string]: unknown }>
}

export interface SurfaceDeps {
  engine: ReconcileEngine
  ledgers: LedgerDirectory
  goals: GoalsView
  userQuestions: UserQuestionsView | null
  maxGoalRounds: number
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void
  /** 冷重建并缓存该 agent 的 ledger（engine 事件面全部依赖它先就位） */
  ensureLedger(agentId: string): Promise<unknown>
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
                'Draft a GoalSpec for it: a short objective, 1-5 concrete successCriteria (predicates: exit_code | artifact | llm_rubric | human; prefer the lowest verifier level that can prove it), optional constraints/nonGoals/assumptions/budget.maxRounds.',
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

/** 模型侧工具注册（claim 永远只是 claim）。 */
export function registerTools(tools: ToolsView, deps: SurfaceDeps): void {
  tools.register({
    name: 'gungnir_submit_spec',
    description: 'Submit a drafted GoalSpec for one-shot human confirmation. On approval Gungnir commits it and arms the native goal.',
    parameters: {
      spec: { type: 'any', required: true, description: 'Complete GoalSpec object (specId, version, objective, successCriteria[] with predicate+verifierLevel, constraints, nonGoals, assumptions, budget)' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('gungnir_submit_spec requires an agent context')
      if (deps.userQuestions === null) throw new Error('userQuestions service unavailable: use /ultragoal --spec <path> for unattended flows')
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
      const approved = Object.values(answer).some((value) => value === true || value === 'yes' || value === 'confirm')
      if (!approved) {
        return { status: 'rejected', message: 'Human did not confirm; revise the spec if asked again.' }
      }
      await deps.ensureLedger(agent.id)
      const { specId } = await deps.engine.commitSpec(agent.id, args['spec'])
      const spec = args['spec'] as { objective?: string }
      deps.goals.create(agent, { objective: spec.objective ?? specId, maxGoalRounds: deps.maxGoalRounds })
      return { status: 'committed', specId }
    },
  })

  tools.register({
    name: 'gungnir_plan',
    description: 'Submit a rolling-horizon projection. The harness commits the first actionable step as this round\'s single action.',
    parameters: {
      rationale: { type: 'string', required: true, description: 'Why this projection now (esp. after REPLAN)' },
      steps: {
        type: 'array',
        required: true,
        description: 'Ordered steps: [{ id, summary, targetsCriteria: string[], expectedEvidence?: string[] }]',
      },
    },
    output: {
      schema: { type: 'object' },
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
  })

  tools.register({
    name: 'gungnir_report',
    description: 'Report your outcome for the committed action. This is a CLAIM — verdicts come only from harness-verified evidence.',
    parameters: {
      summary: { type: 'string', required: true, description: 'What you did and observed' },
      asserted_outcome: { type: 'string', required: true, description: 'done | partial | failed | blocked' },
      evidence_refs: { type: 'array', description: 'evidenceIds you believe support the claim' },
    },
    output: {
      schema: { type: 'object' },
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
  })
}
