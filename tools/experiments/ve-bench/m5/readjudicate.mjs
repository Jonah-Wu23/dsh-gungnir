// 用修复后法官重判被 S1 误杀的 run（复用已存交付工作区 + tool-log，不重跑模型）
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDispatchContract, contractToSupplied } from '../../../../packages/core/dist/contract.js'
import { adjudicate } from '../../../ve-supply/adjudicate.mjs'
import { extractGitSnapshot } from '../../../ve-supply/snapshot.mjs'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const runDir = process.argv[2]
const targets = process.argv.slice(3)
const dir = resolve(runDir)

for (const target of targets) {
  const ws = join(dir, `ws-${target}`)
  const toolLogPath = join(dir, `${target}.tool-log.jsonl`)
  const contract = parseDispatchContract(JSON.parse(readFileSync(join(dir, `${target}.contract.json`), 'utf8')))
  const supplied = contractToSupplied(contract)
  // baselineRef 填回（契约冻结档里有 commit）
  if (supplied.replay !== undefined) {
    const snap = mkdtempSync(join(tmpdir(), 'm5-readjud-'))
    extractGitSnapshot({ repoDir: ws, commit: supplied.replay.buggyRef.commit, destDir: snap })
    const verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: snap, toolLogPath })
    rmSync(snap, { recursive: true, force: true })
    console.log(`${target}: re-adjudicated → ${verdict.stackVerdict}`)
    for (const reason of verdict.reasons) console.log(`  - ${reason.slice(0, 140)}`)
    writeFileSync(join(dir, `${target}.readjudicated.json`), JSON.stringify({ verdict, ts: Date.now() }, null, 2) + '\n', 'utf8')
  } else {
    const verdict = await adjudicate({ workspace: ws, supplied, buggyBaseDir: undefined, toolLogPath })
    console.log(`${target}: re-adjudicated (no replay) → ${verdict.stackVerdict}`)
    writeFileSync(join(dir, `${target}.readjudicated.json`), JSON.stringify({ verdict, ts: Date.now() }, null, 2) + '\n', 'utf8')
  }
}
