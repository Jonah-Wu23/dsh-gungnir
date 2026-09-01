/**
 * ve-supply/snapshot.mjs — 派发点工作区快照提取（M-B buggy 基底来源，ADR-0020 第 3 条）。
 *
 * baselineRef（git commit/tree）→ 用 `git archive` 把派发点工作区提取到系统临时目录，
 * 供 M-B 当 buggy 基底 replay 声称证据。
 *
 * 纪律：无 baselineRef → M-B 不启用并记入供给覆盖报告（run-supply 侧处理，不假装 replay）；
 * baselineRef 存在但 git archive 失败 → loud fail（硬异常，不静默跳过）。
 * 本文件为新产品代码，不 import tools/experiments/ 冻结物。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 提取 git 快照到目标目录。
 * @param {object} options
 * @param {string} options.repoDir 交付工作区（git 仓库根）
 * @param {string} options.commit  派发点 commit（任务开始前的快照）
 * @param {string} options.destDir 目标目录（须为空或不存在；本函数创建）
 * @returns {{ dir: string }}
 */
export function extractGitSnapshot({ repoDir, commit, destDir }) {
  if (!existsSync(join(repoDir, '.git'))) throw new Error(`snapshot: not a git repository: ${repoDir}`)
  mkdirSync(destDir, { recursive: true })
  // Windows 上 bsdtar 对反斜杠路径解析异常（"Cannot connect to C:"），统一转正斜杠
  const archiveTar = join(destDir, 'baseline.tar').replace(/\\/g, '/')
  const destForward = destDir.replace(/\\/g, '/')
  const archive = spawnSync('git', ['-C', repoDir.replace(/\\/g, '/'), 'archive', '--format=tar', commit, '-o', archiveTar], {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  if (archive.status !== 0) {
    throw new Error(
      `snapshot: git archive ${commit} failed (exit ${archive.status}): ${(archive.stderr ?? archive.stdout ?? '').slice(0, 300)}`,
    )
  }
  const extract = spawnSync('tar', ['-xf', 'baseline.tar'], {
    cwd: destDir,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  if (extract.status !== 0) {
    throw new Error(`snapshot: tar extract failed (exit ${extract.status}): ${(extract.stderr ?? extract.stdout ?? '').slice(0, 300)}`)
  }
  return { dir: destDir }
}

/** CLI：node snapshot.mjs --repo <dir> --commit <hash> [--out <dir>]（--out 缺省 = 系统临时目录） */
function main(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i]
    else if (argv[i] === '--commit') args.commit = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  if (args.repo === undefined || args.commit === undefined) {
    throw new Error('usage: node snapshot.mjs --repo <dir> --commit <hash> [--out <dir>]')
  }
  const dest = args.out ?? mkdtempSync(join(tmpdir(), 've-supply-base-'))
  extractGitSnapshot({ repoDir: args.repo, commit: args.commit, destDir: dest })
  console.log(`snapshot: extracted ${args.commit} → ${dest}`)
}

// 仅在直接执行时跑 CLI
if (process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('/snapshot.mjs')) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
