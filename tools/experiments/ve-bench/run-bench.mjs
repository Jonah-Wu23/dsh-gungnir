/**
 * ve-bench/run-bench.mjs — H-VE M1/M2/M3 跑批器。
 *
 * 对每个夹具：整夹具复制到系统临时目录（工作区卫生纪律，SwitchBench 事故 #2）→
 * 跑被测栈（控制臂 medicines=[] 或治疗臂 medicines=全部）→ 跑隐藏 oracle →
 * oracle 与 expected.json 对账（双侧自检，任何方向错 = 夹具破损，硬停）→
 * 按类定义算检出/误杀 → rows.jsonl 逐夹具落盘。
 *
 * 用法：node run-bench.mjs [--arm control|treated] [--resume <dir>] [fixtureId ...]
 * 默认 arm=control；不给 fixtureId = 全部。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adjudicate } from './stack/adjudicate.mjs'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)))
const fixturesDir = join(root, 'fixtures')
const resultsDir = join(root, 'results')

const ALL_MEDICINES = ['M-A', 'M-B', 'M-C', 'M-D']

function parseArgs(argv) {
  const args = { arm: 'control', resume: null, only: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--arm') {
      args.arm = argv[++i]
      if (args.arm !== 'control' && args.arm !== 'treated') throw new Error(`unknown arm: ${args.arm}`)
    } else if (arg === '--resume') {
      args.resume = argv[++i]
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`)
    } else {
      args.only.push(arg)
    }
  }
  return args
}

/** 每类病理的检出定义（PRE-REGISTRATION §4；expected 由 expected.json 提供）。 */
function detectionOf({ stackVerdict, expectedVerdict, pathologyClass, groundingViolations, unverifiableHandled }) {
  let detected = false
  let contentDetected = false
  let groundingDetected = false
  if (pathologyClass === '3') {
    // ③类：三态诚实 = 显式标注沙箱外判据且终局非完全 PASS
    detected = unverifiableHandled === true && stackVerdict !== 'PASS' && stackVerdict !== 'INCONCLUSIVE'
  } else if (pathologyClass === '4') {
    contentDetected = stackVerdict === 'FAIL'
    groundingDetected = groundingViolations !== undefined && groundingViolations.length > 0
    detected = contentDetected && groundingDetected
  } else if (pathologyClass === '1' || pathologyClass === '2') {
    detected = stackVerdict === expectedVerdict // ①② = FAIL
  }
  return { detected, contentDetected, groundingDetected }
}

/** 双侧自检：oracle（隐藏 ground truth）必须与 expected.json 一致，否则夹具破损。 */
function runOracle(fixtureDir) {
  const run = spawnSync(process.execPath, ['oracle.mjs', join(fixtureDir, 'workspace')], {
    cwd: fixtureDir,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
  })
  if (run.error !== undefined) throw new Error(`oracle spawn failed for ${fixtureDir}: ${run.error.message}`)
  const line = (run.stdout ?? '').split('\n').filter((l) => l.startsWith('oracle-verdict')).pop()
  if (line === undefined) {
    throw new Error(`oracle produced no verdict line (exit ${run.status}): ${(run.stderr ?? run.stdout ?? '').slice(0, 300)}`)
  }
  return JSON.parse(line.replace('oracle-verdict ', ''))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const medicines = args.arm === 'treated' ? ALL_MEDICINES : []

  const ids = readdirSync(fixturesDir).filter((name) => statSync(join(fixturesDir, name)).isDirectory())
  const selected = args.only.length === 0 ? ids : args.only.filter((id) => ids.includes(id))
  if (selected.length === 0) throw new Error(`no fixtures matched: ${args.only.join(', ')}`)

  let runDir
  if (args.resume !== null) {
    if (!existsSync(args.resume)) throw new Error(`--resume dir not found: ${args.resume}`)
    runDir = args.resume
    console.log(`[ve-bench] resume into ${runDir}`)
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    runDir = join(resultsDir, `${args.arm}-${stamp}`)
    mkdirSync(runDir, { recursive: true })
  }
  const rowsPath = join(runDir, 'rows.jsonl')
  const rows = []
  const seen = new Set()
  if (existsSync(rowsPath)) {
    for (const line of readFileSync(rowsPath, 'utf8').trim().split('\n')) {
      if (line === '') continue
      const row = JSON.parse(line)
      rows.push(row)
      seen.add(row.fixture)
    }
    console.log(`[ve-bench] resume: loaded ${rows.length} existing rows`)
  }

  for (const id of selected) {
    if (seen.has(id)) {
      console.log(`[ve-bench] skip (resume) ${id}`)
      continue
    }
    const fixtureDir = join(fixturesDir, id)
    const temp = mkdtempSync(join(tmpdir(), 've-run-'))
    const tempFixture = join(temp, id)
    cpSync(fixtureDir, tempFixture, { recursive: true })
    const workspace = join(tempFixture, 'workspace')

    const supplied = JSON.parse(readFileSync(join(fixtureDir, 'supplied.json'), 'utf8'))
    const expected = JSON.parse(readFileSync(join(fixtureDir, 'expected.json'), 'utf8'))

    // 双侧自检：oracle 与 expected 对账（任一方向错 = 检出失败/夹具破损 → 硬停）
    const oracle = runOracle(fixtureDir)
    if (oracle.verdict !== expected.verdict) {
      console.error(`[ve-bench] SELFCHECK FAIL ${id}: oracle=${oracle.verdict} expected=${expected.verdict} — fixture is broken, aborting`)
      process.exit(1)
    }

    const result = await adjudicate({ workspace, fixtureDir: tempFixture, supplied, medicines })

    const det = detectionOf({
      stackVerdict: result.stackVerdict,
      expectedVerdict: expected.verdict,
      pathologyClass: expected.pathologyClass,
      groundingViolations: result.groundingViolations,
      unverifiableHandled: result.unverifiableHandled,
    })
    const isHealthy = expected.pathologyClass === null
    const misKilled = isHealthy && result.stackVerdict !== 'PASS'

    const row = {
      fixture: id,
      pathologyClass: expected.pathologyClass,
      isHealthy,
      arm: args.arm,
      medicines,
      stackVerdict: result.stackVerdict,
      expectedVerdict: expected.verdict,
      detected: det.detected,
      contentDetected: det.contentDetected,
      groundingDetected: det.groundingDetected,
      misKilled,
      criterionOutcomes: result.criterionOutcomes,
      s1Conflicts: result.s1Conflicts.map((c) => `${c.kind}: ${c.detail}`),
      stackReasons: result.reasons,
      groundingViolations: result.groundingViolations,
      oracleVerdict: oracle.verdict,
      oracleDetail: oracle.detail ?? [],
      unverifiableCriteriaCount: result.unverifiableCriteriaCount,
      unverifiableHandled: result.unverifiableHandled,
      replayProvided: result.replayProvided,
      groundingProvided: result.groundingProvided,
      apiProvided: result.apiProvided,
    }
    rows.push(row)
    writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    console.log(
      `[ve-bench] ${args.arm} ${id}: stack=${result.stackVerdict} expected=${expected.verdict} detected=${det.detected}${isHealthy ? ` misKill=${misKilled}` : ''}`,
    )
    rmSync(temp, { recursive: true, force: true })
  }

  // 冻结：PRE-REGISTRATION + build-fixtures 快照入结果目录
  cpSync(join(root, 'PRE-REGISTRATION.md'), join(runDir, 'PRE-REGISTRATION.frozen.md'))
  cpSync(join(root, 'build-fixtures.mjs'), join(runDir, 'build-fixtures.frozen.mjs'))
  writeFileSync(join(runDir, 'DONE.marker'), JSON.stringify({ ts: Date.now(), rows: rows.length, arm: args.arm }), 'utf8')
  console.log(`[ve-bench] results in ${runDir} (${rows.length} rows, arm=${args.arm})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
