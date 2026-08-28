/**
 * freeze.mjs — 为每个任务的 pristine repo 生成 manifest.json（完整性清单）。
 *
 * manifest 内容：
 * - files: src/** 以外的所有文件的 sha256（key 为 POSIX 相对路径）
 * - exports: 每个 src/*.js 模块的导出名排序清单（API 稳定性检查基线）
 *
 * repo 模板或冻结稿变更后必须重跑：node src/freeze.mjs [taskId ...]
 * manifest 生成后视为冻结物；verify.mjs 以它为唯一对照基准。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { TASKS } from './tasks.mjs'

const switchbenchRoot = fileURLToPath(new URL('..', import.meta.url))

function walk(dir, base = dir) {
  const entries = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) entries.push(...walk(full, base))
    else entries.push(full)
  }
  return entries
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

const only = process.argv.slice(2)
const selected = only.length === 0 ? TASKS : TASKS.filter((task) => only.includes(task.id))

for (const task of selected) {
  const repoDir = join(switchbenchRoot, 'tasks', task.dir, 'repo')
  const files = {}
  const exportsMap = {}
  for (const filePath of walk(repoDir)) {
    const rel = relative(repoDir, filePath).split(sep).join('/')
    if (rel === 'src' || rel.startsWith('src/')) {
      if (rel.endsWith('.js')) {
        const module = await import(pathToFileURL(filePath).href)
        exportsMap[rel] = Object.keys(module).sort()
      }
      continue
    }
    files[rel] = sha256(filePath)
  }
  const manifestPath = join(switchbenchRoot, 'tasks', task.dir, 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify({ files, exports: exportsMap }, null, 2)}\n`, 'utf8')
  console.log(`${task.id}: ${Object.keys(files).length} frozen files, ${Object.keys(exportsMap).length} src modules -> manifest.json`)
}
