import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactVerifier } from 'dsh-gungnir/verifiers/artifact.js'
import { ReconcileEngine, type EngineHooks, type LedgerDirectory } from 'dsh-gungnir/engine.js'
import type { VerifyContext } from '@gungnir/core'
import type { AgentLedger } from 'dsh-gungnir/ledger.js'

/** 隔离的临时 workspace（引擎 ArtifactVerifier 的围栏根）。 */
export function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'gungnir-destruction-'))
}

export interface RecordedHooks extends EngineHooks {
  directives: string[]
  errors: string[]
  warnings: string[]
}

export function recordingHooks(): RecordedHooks {
  const hooks: RecordedHooks = {
    directives: [],
    errors: [],
    warnings: [],
    injectDirective(agentId, text) {
      hooks.directives.push(`[${agentId}] ${text}`)
    },
    log(level, message, detail) {
      if (level === 'error') hooks.errors.push(`${message}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`)
      if (level === 'warn') hooks.warnings.push(message)
    },
  }
  return hooks
}

export function offlineVerifyContext(workspaceRoot: string): VerifyContext {
  return {
    workspaceRoot,
    async runCommand() {
      throw new Error('offline destruction harness: no command executor')
    },
    async readFile(path) {
      const { readFile } = await import('node:fs/promises')
      const { resolve, sep } = await import('node:path')
      const root = resolve(workspaceRoot)
      const target = resolve(root, path)
      if (target !== root && !target.startsWith(root + sep)) return null
      return readFile(target, 'utf8').catch(() => null)
    },
    async completeRubric() {
      throw new Error('offline destruction harness: no llm')
    },
    now: () => Date.now(),
  }
}

export function engineFor(ledger: AgentLedger, workspaceRoot: string, hooks: EngineHooks = recordingHooks()): { engine: ReconcileEngine; hooks: RecordedHooks } {
  const recorded = hooks instanceof Object && 'directives' in hooks ? (hooks as RecordedHooks) : recordingHooks()
  const directory: LedgerDirectory = { get: (agentId) => (agentId === ledger.agentId ? ledger : undefined) }
  const engine = new ReconcileEngine(directory, offlineVerifyContext(workspaceRoot), [new ArtifactVerifier()], recorded)
  return { engine, hooks: recorded }
}

/** 与插件相同的 agentId 约定。 */
export const AGENT = 'agent-under-destruction'
