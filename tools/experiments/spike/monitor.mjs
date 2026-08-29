/**
 * spike/monitor.mjs — 正式批实时监控（与 run-groups.mjs 并行运行）。
 *
 * 每 2 分钟轮询一次 run 目录：
 * - .heartbeat 新鲜度（> 10 分钟未更新 = 疑似僵死 → 告警）；
 * - output-*.log 文件数（进度）；
 * - rows.jsonl 行数（进度）；
 * - 流式日志扫描异常标记：HARD ABORT / [gungnir] error / RUN TIMEOUT；
 * - DONE.marker 出现 = 批完成。
 * 用法：node monitor.mjs <results/spike-<ts>>
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const runDir = process.argv[2]
if (runDir === undefined) throw new Error('usage: node monitor.mjs <results/spike-<ts>>')

const expectedPhysical = 32
let lastCount = -1
let staleStreak = 0

console.log(`[monitor] watching ${runDir}`)
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 120_000))
  if (!existsSync(runDir)) {
    console.log(`[monitor][${new Date().toISOString()}] WARN: run dir missing`)
    continue
  }
  const outputs = readdirSync(runDir).filter((name) => name.startsWith('output-'))
  const rowsPath = join(runDir, 'rows.jsonl')
  const rowCount = existsSync(rowsPath) ? readFileSync(rowsPath, 'utf8').trim().split('\n').filter((l) => l !== '').length : 0
  const done = existsSync(join(runDir, 'DONE.marker'))
  // heartbeat
  let heartbeat = 'n/a'
  const hbPath = join(runDir, '.heartbeat')
  if (existsSync(hbPath)) {
    try {
      const hb = JSON.parse(readFileSync(hbPath, 'utf8'))
      const ageMin = (Date.now() - (hb.ts ?? 0)) / 60_000
      heartbeat = `${hb.tag ?? '?'} age=${ageMin.toFixed(1)}min`
      if (ageMin > 10 && !hb.done) {
        staleStreak++
        console.log(`[monitor][${new Date().toISOString()}] WARN: heartbeat stale ${ageMin.toFixed(1)}min (${hb.tag})`)
      } else {
        staleStreak = 0
      }
    } catch {
      heartbeat = 'unreadable'
    }
  }
  // 流式日志扫描
  let anomalies = []
  for (const name of outputs.slice(-4)) {
    try {
      const text = readFileSync(join(runDir, name), 'utf8')
      if (text.includes('HARD ABORT')) anomalies.push(`${name}: HARD ABORT`)
      if (text.includes('RUN TIMEOUT')) anomalies.push(`${name}: TIMEOUT`)
      if (/\[gungnir\] error/.test(text)) anomalies.push(`${name}: plugin error`)
    } catch {
      // 正在写入的文件可能瞬时不可读
    }
  }
  const progress = outputs.length
  const delta = lastCount >= 0 ? ` (+${progress - lastCount})` : ''
  lastCount = progress
  console.log(`[monitor][${new Date().toISOString()}] runs=${progress}/${expectedPhysical}${delta} rows=${rowCount} hb=${heartbeat}${done ? ' DONE' : ''}${anomalies.length > 0 ? ` ANOMALIES: ${anomalies.join('; ')}` : ''}`)
  if (staleStreak >= 2) {
    console.log(`[monitor][${new Date().toISOString()}] ALERT: heartbeat stale for ${staleStreak} polls — batch may be stuck, consider stopping`)
  }
  if (done) {
    console.log(`[monitor][${new Date().toISOString()}] BATCH COMPLETE`)
    process.exit(0)
  }
}
