/**
 * replay-p3.mjs — P3 BPAR v0.1 确认批：离线 replay 回归（零模型调用）。
 *
 * 对 P2 留档 tool-log + 契约，用"新栈"（重建后的 core + dsh-plugin dist，含 S1 完成
 * 调用豁免，ADR-0022）经真实运行时路径（PassivePlaneRuntime.onToolResult → wrapup
 * claim-check）重放：
 * - R-p1：P2 E2-gpt-H1-a 原案（update_goal complete 误传 edit 专属参数报错，P2 唯一
 *   一次 S1 真阳性拦截）→ 必须**零拦截**（完成调用报错豁免生效：工具拒绝即完成未
 *   成立，错误自明，模型自行重试）；
 * - R-p2/R-p3：P2 ③ 拦截案（E2-deepseek-T3-cli-retry-a/b，运行期 unverifiable-claim
 *   拦截）→ 必须**仍拦下**（豁免只抑制"完成调用自身报错"，不破坏其他拦截路径）。
 *
 * 判定门 G-FIX 的 replay 半边：三项全过 = 修复在"原失败点生效 + 拦截能力未破坏"。
 * 契约判据（L1）在归档工作区（results/p2-<stamp>/ws-<tag>/）真实执行；replay 用归档
 * 终态工作区，零模型调用、确定性、可审计。
 *
 * 用法：node replay-p3.mjs [--results <dir>] [--cases R-p1,R-p2,R-p3]
 * 退出码：0 = 全部通过；1 = 任一 FAIL（熔断语义，走判定门）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassivePlaneRuntime } from '../../../../packages/dsh-plugin/dist/passive-plane.js'
import { parseDispatchContract, contractToSupplied } from '../../../../packages/core/dist/contract.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RESULTS = join(HERE, 'results', 'p2-2026-08-31T15-09-16-315Z')

/** replay 用例表：tag = P2 留档行名；expect = 拦截断言（zero = 原案零拦截）。 */
const CASES = {
  'R-p1': { tag: 'E2-gpt-H1-cachekit-a', expect: 'zero-interventions' },
  'R-p2': { tag: 'E2-deepseek-T3-cli-retry-a', expect: 'must-intervene' },
  'R-p3': { tag: 'E2-deepseek-T3-cli-retry-b', expect: 'must-intervene' },
}

function parseArgs(argv) {
  const args = { results: DEFAULT_RESULTS, cases: Object.keys(CASES) }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--results') args.results = argv[++i]
    else if (argv[i] === '--cases') args.cases = argv[++i].split(',')
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  for (const id of args.cases) {
    if (CASES[id] === undefined) throw new Error(`unknown case: ${id} (known: ${Object.keys(CASES).join(',')})`)
  }
  return args
}

/** 真实执行归档工作区中的命令（L1 判据；assessContractCriteria 已做沙箱兼容变换）。 */
function makeRunCommand(ws) {
  return async (command, timeoutMs = 120_000) => {
    const result = spawnSync(command, { cwd: ws, shell: true, encoding: 'utf8', timeout: Math.min(timeoutMs, 180_000), windowsHide: true })
    return { exitCode: result.status ?? -1 }
  }
}

function makeReadFile(ws) {
  return async (path) => {
    try {
      return readFileSync(join(ws, path), 'utf8')
    } catch {
      return null
    }
  }
}

/**
 * 重放单个留档 run：tool/call 与 tool/result 按序喂入运行时（callId → args 配对，
 * 与插件 onToolResult 的 arguments 输入同构）；wrapup claim-check 在 update_goal
 * complete/blocked 结果上自动触发。返回 wrapup 评估日志 + 注入的 MAF 消息。
 */
async function replayCase(tag, wsDir, resultsDir) {
  const toolLogPath = join(resultsDir, `${tag}.tool-log.jsonl`)
  const contractPath = join(resultsDir, `${tag}.contract.json`)
  const wsPath = join(resultsDir, `ws-${tag}`)
  if (!existsSync(toolLogPath) || !existsSync(contractPath)) throw new Error(`archived files missing for ${tag}: tool-log / contract`)
  if (!existsSync(wsPath)) throw new Error(`archived workspace missing for ${tag}: ws-${tag}`)

  const contract = parseDispatchContract(JSON.parse(readFileSync(contractPath, 'utf8')))
  const supplied = contractToSupplied(contract)
  const events = readFileSync(toolLogPath, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))

  const messages = []
  const wrapupLogs = []
  const runtime = new PassivePlaneRuntime(
    {
      ledgerOf: () => undefined,
      ensureLedger: async () => undefined,
      injectMessage: (agentId, text) => messages.push(text),
      runCommand: makeRunCommand(wsPath),
      readFile: makeReadFile(wsPath),
      workspaceRoot: wsPath,
      log: (level, message) => {
        if (message.includes('claim-check')) wrapupLogs.push(message)
      },
    },
    { supplied, escalation: true },
  )

  const argsByCallId = new Map()
  let lastStep = null
  let first = true
  for (const event of events) {
    if (event.step !== lastStep) {
      if (!first) runtime.observeStep(tag)
      lastStep = event.step
      first = false
    }
    if (event.type === 'tool/call') {
      argsByCallId.set(event.callId, event.args ?? {})
    } else if (event.type === 'tool/result') {
      await runtime.onToolResult(tag, {
        name: event.name,
        arguments: argsByCallId.get(event.callId),
        text: typeof event.text === 'string' ? event.text : '',
        isError: event.isError === true,
        callId: event.callId,
      })
    }
  }
  return { messages, wrapupLogs }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const resultsDir = resolve(args.results)
  const checks = []
  let ok = true
  console.log(`[replay-p3] results=${resultsDir} cases=${args.cases.join(',')}`)
  for (const id of args.cases) {
    const spec = CASES[id]
    const { messages, wrapupLogs } = await replayCase(spec.tag, `ws-${spec.tag}`, resultsDir)
    const interventions = messages.length
    const wrapupSummary = wrapupLogs.map((line) => line.replace('passive claim-check ', '').split(' (completion')[0])
    let pass
    if (spec.expect === 'zero-interventions') {
      pass = interventions === 0
    } else {
      pass = interventions >= 1
    }
    if (!pass) ok = false
    checks.push({ case: id, tag: spec.tag, expect: spec.expect, interventions, wrapupSummary, pass })
    console.log(`${pass ? '✓' : '✗'} ${id} (${spec.tag}): interventions=${interventions} (expect ${spec.expect === 'zero-interventions' ? '0' : '>=1'})`)
    for (const summary of wrapupSummary) console.log(`    wrapup: ${summary}`)
    if (interventions > 0) console.log(`    MAF messages: ${messages.length}${messages[0] !== undefined ? ` (first: ${messages[0].slice(0, 80)}...)` : ''}`)
  }
  writeFileSync(join(resultsDir, 'replay-report.json'), JSON.stringify({ ts: Date.now(), results: resultsDir, cases: args.cases, checks, allPass: ok }, null, 2) + '\n', 'utf8')
  console.log(`[replay-p3] ${ok ? 'ALL PASS' : 'FAIL'} — report: ${join(resultsDir, 'replay-report.json')}`)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error(`[replay-p3] FATAL: ${error.message}`)
  process.exit(1)
})
