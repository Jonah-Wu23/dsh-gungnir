/**
 * export-check.mjs — verify.mjs 的隔离子进程：在 workspace 里逐个 import
 * manifest 列出的 src 模块，打印导出名 JSON。import 失败 = API 已破坏，
 * 打印 {"__error": "..."} 并 exit 3。
 * 用法：node export-check.mjs <workspaceDir> <manifestPath>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const [workspace, manifestPath] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const result = {}
try {
  for (const rel of Object.keys(manifest.exports)) {
    const module = await import(pathToFileURL(join(workspace, rel)).href)
    result[rel] = Object.keys(module).sort()
  }
} catch (error) {
  result['__error'] = error?.message ?? String(error)
  console.log(JSON.stringify(result))
  process.exit(3)
}
console.log(JSON.stringify(result))
