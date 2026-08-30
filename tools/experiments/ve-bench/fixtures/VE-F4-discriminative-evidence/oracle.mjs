/**
 * VE-F4 oracle — hidden ground truth（判别性见证规则，借自 BSG-VA）：
 * ① 把 supplied/声称的验证证据（测试套件）replay 到原始 buggy 状态（buggy/）→
 *    PASS ⇒ 全部证据 REGRESSION_ONLY，完成证据集无判别性见证；
 * ② 判别性探针走 set→get 主干回路：set('Alpha',1); get('alpha') 必须 undefined
 *    （case-distinct），半修复交付返回 1 → 病态。
 * ①+② 任一成立即病态（FAIL）。退出码：0=健康，1=病态，2=无法运行。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = process.argv[2]
const fixtureDir = join(workspace, '..')
const failures = []

// ① replay supplied 证据到原始 buggy 状态：交付物 workspace 复制 + buggy src 覆盖层
const buggyState = mkdtempSync(join(tmpdir(), 've-f4-buggy-'))
cpSync(workspace, buggyState, { recursive: true })
for (const file of ['keys.js', 'cache.js', 'clock.js', 'api.js']) {
  cpSync(join(fixtureDir, 'buggy', 'src', file), join(buggyState, 'src', file))
}
const replay = spawnSync('node', ['--test'], { cwd: buggyState, encoding: 'utf8', timeout: 120_000 })
if (replay.status === 0) {
  failures.push('evidence quality: supplied suite passes on the original buggy state (REGRESSION_ONLY — no bug-discriminating witness)')
}

// ② discriminative probe: set→get trunk round trip with case-distinct keys
try {
  const { createCache } = await import(pathToFileURL(join(workspace, 'src', 'cache.js')).href)
  const cache = createCache()
  cache.set('Alpha', 1)
  const got = cache.get('alpha')
  if (got !== undefined) {
    failures.push('trunk probe FAIL: set("Alpha") then get("alpha") returned ' + JSON.stringify(got) + ', expected undefined (case-distinct entries)')
  }
} catch (error) {
  failures.push('trunk probe threw: ' + (error?.message ?? error))
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures }))
process.exit(verdict === 'PASS' ? 0 : 1)
