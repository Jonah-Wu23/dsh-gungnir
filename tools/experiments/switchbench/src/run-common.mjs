/**
 * run-common.mjs — A/B runner 的公共件（工作区物料化 + src 足迹）。
 *
 * 与 run-baseline.mjs（Day 1 产物，未改动）逻辑等价的独立实现：工作区必须
 * 物料化到系统临时目录（远离仓库树——Day 1 首跑读穿 harness 判废的教训，
 * BENCHMARK.md §7 事故 #2），src 足迹作纪律证据。判定一律走冻结 verify.mjs。
 */
import { createHash } from 'node:crypto'
import { cpSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function materializeWorkspace(taskDir, workspace) {
  cpSync(join(taskDir, 'repo'), workspace, { recursive: true })
}

export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** src 足迹：工作区 src 相对 pristine 模板的 changed/added/deleted（纪律证据）。 */
export function srcFootprint(workspace, taskDir) {
  function srcFiles(root) {
    const map = new Map()
    const stack = [join(root, 'src')]
    while (stack.length > 0) {
      const dir = stack.pop()
      let entries
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of entries) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) stack.push(full)
        else map.set(join(full, '').replace(root, '').replace(/\\/g, '/'), sha256File(full))
      }
    }
    return map
  }
  const pristine = srcFiles(join(taskDir, 'repo'))
  const current = srcFiles(workspace)
  const changed = []
  const added = []
  const deleted = []
  for (const [rel, digest] of current.entries()) {
    const before = pristine.get(rel)
    if (before === undefined) added.push(rel)
    else if (before !== digest) changed.push(rel)
  }
  for (const rel of pristine.keys()) if (!current.has(rel)) deleted.push(rel)
  return { changed: changed.sort(), added: added.sort(), deleted: deleted.sort() }
}
