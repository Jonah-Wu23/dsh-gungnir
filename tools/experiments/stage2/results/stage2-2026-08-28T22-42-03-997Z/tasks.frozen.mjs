/**
 * stage2/tasks.mjs — 四组对照实验任务集（预注册冻结，见 PRE-REGISTRATION.md）。
 *
 * 每个任务：id / objective（组中立目标）/ setup（跑前预置文件）/ groundTruth（确定性谓词，
 * 跑批器对所有组统一判定）。谓词语义与 Gungnir L1(exit_code)/L2(artifact) 一致。
 */

const FILES = {
  t2: {
    'fmt.js': `export function formatPrice(cents) {\n  // BUG: should round half-up to the nearest cent, but truncates\n  return '$' + (Math.floor(cents) / 100).toFixed(2);\n}\n`,
    'fmt.test.js': `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatPrice } from './fmt.js';\n\ntest('rounds half-up to cents', () => {\n  assert.equal(formatPrice(199), '$1.99');\n  assert.equal(formatPrice(1250), '$12.50');\n  assert.equal(formatPrice(999), '$9.99');\n});\n\ntest('handles fractional cents (half-up)', () => {\n  assert.equal(formatPrice(199.5), '$2.00');\n});\n`,
  },
  t3: {
    'data.csv': `category,amount\nfood,120\nfood,80\ntools,300\ntools,45\nfood,60\nmisc,25\n`,
  },
  t4: {
    'config.js': `export const MAX_RETRIES = 3;\n`,
    'client.js': `import { MAX_RETRIES } from './config.js';\nexport function fetchConfig() {\n  for (let i = 0; i < 3; i++) { /* retry loop uses the literal */ }\n  return 3;\n}\n`,
    'queue.js': `export function drain(items) {\n  let attempts = 0;\n  while (attempts < 3) { attempts++; }\n  return attempts;\n}\n`,
  },
  t5: {
    'README.md': `# Deploy runbook\nDeploy order: database migration first, then api, then worker.\nRollback: run scripts/rollback.sh within 30 minutes of a failed deploy.\nOwner: platform-team.\n`,
    'notes.txt': `Reminder: the deploy window is Tuesday 06:00-08:00 UTC.\n`,
  },
}

export const TASKS = [
  {
    id: 't1-multi-file',
    objective: 'Create three files: out/part1.txt with exactly ALPHA, out/part2.txt with exactly BETA, and out/index.txt with exactly two lines: part1:ALPHA then part2:BETA.',
    setup: {},
    groundTruth: [
      { kind: 'artifact', path: 'out/part1.txt', mustExist: true, contains: 'ALPHA' },
      { kind: 'artifact', path: 'out/part2.txt', mustExist: true, contains: 'BETA' },
      { kind: 'artifact', path: 'out/index.txt', mustExist: true, contains: 'part1:ALPHA', contains2: 'part2:BETA' },
    ],
  },
  {
    id: 't2-bugfix-tests',
    objective: 'The file fmt.js has a bug: formatPrice truncates instead of rounding half-up when converting cents to dollars, so fmt.test.js fails. Fix fmt.js (do not modify fmt.test.js) so that `node --test` passes.',
    setup: FILES.t2,
    groundTruth: [
      { kind: 'exit_code', command: 'node --test fmt.test.js', expectedExitCode: 0, timeoutMs: 60_000 },
    ],
  },
  {
    id: 't3-transform',
    objective: 'Read data.csv (header category,amount) and write out/summary.json containing exactly {"total":630,"byCategory":{"food":260,"misc":25,"tools":345}} (categories sorted alphabetically, no extra keys).',
    setup: FILES.t3,
    groundTruth: [
      { kind: 'exit_code', command: 'node -e "const s=require(\'./out/summary.json\'); if (s.total!==630||s.byCategory.food!==260||s.byCategory.tools!==345||s.byCategory.misc!==25||Object.keys(s.byCategory).join(\',\')!==\'food,misc,tools\') process.exit(1)"', expectedExitCode: 0, timeoutMs: 60_000 },
      { kind: 'artifact', path: 'out/summary.json', mustExist: true },
    ],
  },
  {
    id: 't4-refactor',
    objective: 'The literal 3 appears in client.js and queue.js as a retry limit; a config.js already exports MAX_RETRIES. Rewire client.js and queue.js to import and use MAX_RETRIES from config.js instead of the literal. Behavior must stay identical.',
    setup: FILES.t4,
    groundTruth: [
      { kind: 'exit_code', command: 'node -e "import(\'./client.js\').then(m => { if (m.fetchConfig() !== 3) process.exit(1); return import(\'./queue.js\'); }).then(q => { if (q.drain([1,2]) !== 3) process.exit(1); }).catch(() => process.exit(1))"', expectedExitCode: 0, timeoutMs: 60_000 },
      { kind: 'artifact', path: 'client.js', mustExist: true, contains: 'MAX_RETRIES' },
      { kind: 'artifact', path: 'queue.js', mustExist: true, contains: 'MAX_RETRIES' },
    ],
  },
  {
    id: 't5-workspace-qa',
    objective: 'Read README.md and notes.txt and answer this question by writing to out/answer.txt as exactly two lines: line 1 "deploy order: database migration, api, worker"; line 2 "window: Tuesday 06:00-08:00 UTC".',
    setup: FILES.t5,
    groundTruth: [
      { kind: 'artifact', path: 'out/answer.txt', mustExist: true, contains: 'deploy order: database migration, api, worker', contains2: 'window: Tuesday 06:00-08:00 UTC' },
    ],
  },
  {
    id: 't6-knowledge-write',
    objective: 'Write the file out/kv.json with exactly this JSON content: {"a":1,"b":2,"c":3}',
    setup: {},
    groundTruth: [
      { kind: 'artifact', path: 'out/kv.json', mustExist: true, contains: '"a":1', contains2: '"c":3' },
    ],
  },
]

/** 各组 prompt 模板（预注册冻结；组中立目标 + 组特定用法框架）。 */
export function buildPrompt(task, group) {
  const objective = task.objective
  if (group === 'gungnir') {
    return [
      `Objective from the human: ${objective}`,
      'Draft a GoalSpec for it (1-5 concrete successCriteria; prefer the lowest verifier level that can prove it) and call gungnir_submit_spec. Then follow the Gungnir round flow (gungnir_plan → execute → gungnir_report → update_goal) until verified completion.',
    ].join('\n')
  }
  const lines = [
    `OBJECTIVE: ${objective}`,
    'Work in the current workspace. Produce exactly the required artifacts.',
  ]
  if (group === 'workflow') {
    lines.push('You may use the workflow tool to orchestrate multi-step work if helpful.')
  }
  return lines.join('\n')
}

/** 确定性判定（与 Gungnir L1/L2 同语义；对四组统一执行；cwd = run 工作区）。 */
export function judgeTask(task, cwd) {
  const failures = []
  for (const predicate of task.groundTruth) {
    if (predicate.kind === 'artifact') {
      const result = checkArtifact(predicate, cwd)
      if (!result.ok) failures.push(`${predicate.path}: ${result.detail}`)
    } else if (predicate.kind === 'exit_code') {
      const result = checkExitCode(predicate, cwd)
      if (!result.ok) failures.push(`${predicate.command}: exit=${result.exit} ${result.tail ?? ''}`)
    }
  }
  return { success: failures.length === 0, failures }
}

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function checkArtifact(predicate, cwd) {
  const absolute = join(cwd, predicate.path)
  if (!existsSync(absolute)) {
    return predicate.mustExist === false ? { ok: true } : { ok: false, detail: 'missing' }
  }
  if (predicate.mustExist === false) return { ok: false, detail: 'present (must be absent)' }
  const content = readText(absolute) ?? ''
  for (const key of ['contains', 'contains2', 'contains3']) {
    const needle = predicate[key]
    if (needle !== undefined && !content.includes(needle)) {
      return { ok: false, detail: `missing ${key}=${JSON.stringify(needle)}` }
    }
  }
  return { ok: true }
}

function checkExitCode(predicate, cwd) {
  const result = spawnSync(predicate.command, {
    encoding: 'utf8', timeout: predicate.timeoutMs ?? 60_000, shell: true, windowsHide: true, cwd,
  })
  return { ok: result.status === predicate.expectedExitCode, exit: result.status, tail: (result.stderr ?? '').slice(-160) }
}
