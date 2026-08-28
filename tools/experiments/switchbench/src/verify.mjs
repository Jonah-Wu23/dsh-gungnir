/**
 * verify.mjs — SwitchBench 冻结 verifier（Gate 1：VGCR 的 deterministic 判定）。
 *
 * EXPERIMENT.md §7 Gate 1：PASS 必须同时满足四个条件，实现映射：
 * 1. 原 bug 不可复现        -> probe（任务目录下的模型不可见探针）exit 0
 * 2. 主干测试通过           -> `node --test` exit 0（TAP 计数解析）
 * 3. 未破坏核心功能         -> integrity（src/ 外文件逐字节未变）+ exports（导出名集合未变）
 * 4. 用户明确约束全部满足   -> 同上的 integrity（only-src / no-new-deps）+ exports（api-stable）
 *
 * 用法：node src/verify.mjs <workspaceDir> <taskDir>
 * （taskDir = tasks/<id> 目录，内含 probe.mjs 与 manifest.json）
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROBE_TIMEOUT_MS = 60_000
const TRUNK_TIMEOUT_MS = 120_000
const EXPORT_CHECK_TIMEOUT_MS = 30_000

function walk(dir, base = dir) {
  const entries = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue // 单独作为违规信号，不逐文件遍历
      entries.push(...walk(full, base))
    } else {
      entries.push(full)
    }
  }
  return entries
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function checkIntegrity(workspace, manifest) {
  const violations = []
  const current = new Map()
  for (const filePath of walk(workspace)) {
    const rel = relative(workspace, filePath).split(sep).join('/')
    if (rel.startsWith('src/')) continue
    current.set(rel, sha256(filePath))
  }
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (!current.has(rel)) violations.push(`frozen file deleted: ${rel}`)
    else if (current.get(rel) !== hash) violations.push(`frozen file modified: ${rel}`)
    current.delete(rel)
  }
  for (const rel of current.keys()) violations.push(`extra file outside src/: ${rel}`)
  if (statSync(join(workspace, 'node_modules'), { throwIfNoEntry: false }) !== undefined) {
    violations.push('node_modules directory created inside the workspace (no-new-deps violated)')
  }
  return { ok: violations.length === 0, violations }
}

function runChild(bin, args, options) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options })
  if (result.error !== undefined) {
    return { exitCode: null, error: String(result.error.message), stdout: '', stderr: '' }
  }
  return { exitCode: result.status, error: null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function parseTapCounts(stdout) {
  const tests = stdout.match(/^# tests (\d+)/m)
  const pass = stdout.match(/^# pass (\d+)/m)
  const fail = stdout.match(/^# fail (\d+)/m)
  return {
    tests: tests === null ? null : Number(tests[1]),
    pass: pass === null ? null : Number(pass[1]),
    fail: fail === null ? null : Number(fail[1]),
  }
}

export function verifyWorkspace(workspace, taskDir) {
  const manifest = JSON.parse(readFileSync(join(taskDir, 'manifest.json'), 'utf8'))

  const integrity = checkIntegrity(workspace, manifest)

  const exportCheck = runChild(process.execPath, [join(import.meta.dirname, 'export-check.mjs'), workspace, join(taskDir, 'manifest.json')], {
    timeout: EXPORT_CHECK_TIMEOUT_MS,
  })
  let exportsOk = false
  let exportViolations = []
  if (exportCheck.exitCode !== 0) {
    exportViolations = [`export-check failed (exit ${exportCheck.exitCode}): ${(exportCheck.stderr || exportCheck.stdout).slice(-400)}`]
  } else {
    try {
      const current = JSON.parse(exportCheck.stdout)
      for (const [rel, names] of Object.entries(manifest.exports)) {
        const actual = current[rel]
        if (actual === undefined) {
          exportViolations.push(`module missing: ${rel}`)
          continue
        }
        const expectedSorted = [...names].sort()
        if (JSON.stringify(actual) !== JSON.stringify(expectedSorted)) {
          exportViolations.push(`export names changed in ${rel}: expected [${expectedSorted.join(', ')}], got [${actual.join(', ')}]`)
        }
      }
      exportsOk = exportViolations.length === 0
    } catch (error) {
      exportViolations = [`export-check output unparsable: ${error?.message ?? error}`]
    }
  }

  const probe = runChild(process.execPath, [join(taskDir, 'probe.mjs'), workspace], { timeout: PROBE_TIMEOUT_MS })
  const bugNotReproducible = probe.exitCode === 0

  const trunk = runChild(process.execPath, ['--test', '--test-reporter', 'tap'], { cwd: workspace, timeout: TRUNK_TIMEOUT_MS })
  const trunkCounts = parseTapCounts(trunk.stdout)
  const trunkPass = trunk.exitCode === 0

  const coreIntact = integrity.ok && exportsOk
  const constraintsSatisfied = coreIntact // only-src/no-new-deps = integrity；api-stable = exports
  const verdict = bugNotReproducible && trunkPass && coreIntact ? 'PASS' : 'FAIL'

  return {
    verdict,
    gates: {
      bugNotReproducible: { ok: bugNotReproducible, exitCode: probe.exitCode, output: `${probe.stdout}${probe.stderr}`.slice(-2000) },
      trunkTestsPass: { ok: trunkPass, exitCode: trunk.exitCode, counts: trunkCounts, tail: `${trunk.stdout}${trunk.stderr}`.slice(-2000) },
      integrity: { ok: integrity.ok, violations: integrity.violations },
      exports: { ok: exportsOk, violations: exportViolations },
    },
    constraintsSatisfied,
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [workspace, taskDir] = process.argv.slice(2)
  if (workspace === undefined || taskDir === undefined) {
    console.error('usage: node src/verify.mjs <workspaceDir> <taskDir>')
    process.exit(2)
  }
  const result = verifyWorkspace(workspace, taskDir)
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.verdict === 'PASS' ? 0 : 1)
}
