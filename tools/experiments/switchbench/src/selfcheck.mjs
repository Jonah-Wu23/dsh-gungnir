/**
 * selfcheck.mjs — 验证器非空转自检（benchmark 工具的一部分，跑批前后都可复跑）。
 *
 * 对每个任务：
 * 1. pristine 副本  -> verify 必须 FAIL（probe 复现 + 主干测试失败）
 * 2. 手工修复副本   -> verify 必须 PASS（四条件全绿）
 * 两面都符合才说明冻结 verifier 有判别力。任何 repo/manifest 变更后必须重跑。
 *
 * 用法：node src/selfcheck.mjs [taskId ...]
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { TASKS } from './tasks.mjs'
import { verifyWorkspace } from './verify.mjs'

const switchbenchRoot = fileURLToPath(new URL('..', import.meta.url))

/** 各任务植入 bug 的规范修复（与 BENCHMARK.md groundTruth 一致）。 */
const CANONICAL_FIXES = {
  t01: {
    file: 'src/coupons.js',
    content: `import { roundHalfUpCents } from './money.js'

export function applyCoupon(priced, ratePercent) {
  if (ratePercent === null) {
    return { couponDiscount: 0, amountAfterCoupon: priced.discountedSubtotal }
  }
  const couponDiscount = roundHalfUpCents((priced.discountedSubtotal * ratePercent) / 100)
  return { couponDiscount, amountAfterCoupon: priced.discountedSubtotal - couponDiscount }
}
`,
  },
  t02: {
    file: 'src/keys.js',
    content: `export function normalizeKey(key) {
  return key.trim()
}
`,
  },
  t03: {
    file: 'src/csv.js',
    content: `export function toCsv(columns, rows) {
  function renderField(value) {
    const text = String(value ?? '')
    if (/[",\\n\\r]/.test(text)) {
      return \`"\${text.replaceAll('"', '""')}"\`
    }
    return text
  }
  const lines = [columns.map((column) => renderField(column.name)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => renderField(row[column.key])).join(','))
  }
  return lines.join('\\n')
}
`,
  },
  t04: {
    file: 'src/parse.js',
    content: `export function parseTask(payload) {
  if (payload === null || typeof payload !== 'object') {
    throw new TypeError('payload must be an object')
  }
  const raw = payload.priority
  if (typeof raw !== 'string') {
    throw new TypeError('priority must be a string')
  }
  const priority = Number.parseInt(raw.trim(), 10)
  if (!Number.isInteger(priority) || priority < 0) {
    throw new RangeError('priority must be a non-negative integer')
  }
  return { id: payload.id, priority }
}
`,
  },
  t05: {
    file: 'src/segments.js',
    content: `export function matchesAnySegment(user, segmentNames) {
  return segmentNames.some((segment) => user.segments.some((own) => own === segment))
}
`,
  },
}

const only = process.argv.slice(2)
const selected = only.length === 0 ? TASKS : TASKS.filter((task) => only.includes(task.id))
const root = join(tmpdir(), `switchbench-selfcheck-${Date.now()}`)
mkdirSync(root, { recursive: true })

let failures = 0
for (const task of selected) {
  const taskDir = join(switchbenchRoot, 'tasks', task.dir)
  const pristineWs = join(root, `${task.id}-pristine`)
  const fixedWs = join(root, `${task.id}-fixed`)
  cpSync(join(taskDir, 'repo'), pristineWs, { recursive: true })
  cpSync(join(taskDir, 'repo'), fixedWs, { recursive: true })
  const fix = CANONICAL_FIXES[task.id]
  if (fix === undefined) {
    console.error(`${task.id}: no canonical fix registered`)
    failures += 1
    continue
  }
  writeFileSync(join(fixedWs, fix.file), fix.content, 'utf8')

  const pristine = verifyWorkspace(pristineWs, taskDir)
  const fixed = verifyWorkspace(fixedWs, taskDir)
  const pristineOk = pristine.verdict === 'FAIL' && pristine.gates.integrity.ok && pristine.gates.exports.ok
  const fixedOk = fixed.verdict === 'PASS'
  if (!pristineOk || !fixedOk) failures += 1
  console.log(
    `${task.id}: pristine=${pristine.verdict}(integrity:${pristine.gates.integrity.ok},trunk:${pristine.gates.trunkTestsPass.counts?.pass}/${pristine.gates.trunkTestsPass.counts?.tests}) fixed=${fixed.verdict}(trunk:${fixed.gates.trunkTestsPass.counts?.pass}/${fixed.gates.trunkTestsPass.counts?.tests}) -> ${pristineOk && fixedOk ? 'OK' : 'SELFCHECK-FAIL'}`,
  )
}

rmSync(root, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
