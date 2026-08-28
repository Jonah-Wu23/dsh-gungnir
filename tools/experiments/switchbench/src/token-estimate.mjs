/**
 * token-estimate.mjs — 离线 token 估计（用户口径：以模型返回的 usage 为准；
 * usage 不可得的 Baseline 用官方 tokenizer 离线计数，并在报告中标注口径）。
 *
 * 数据通路：
 * - A/B 架构：API usage 实测（metrics.mjs 主口径），另落 payloads.jsonl 供
 *   估计器校准（估计值 vs 真实 usage → 校准比）。
 * - Baseline：session log 重建每轮请求消息序列（baseline-log.reconstructPayloads）
 *   → 本模块调官方 tokenizer 计数。已知的系统性缺口：DSH 注入的 system prompt 与
 *   工具 schema 不在 session log 里 → Baseline 估计值为下界，报告必须写明。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const TOKENIZER_DIR = fileURLToPath(new URL('../../../../deepseek_v4_tokenizer', import.meta.url))
const HELPER = fileURLToPath(new URL('./deepseek-tokenize.py', import.meta.url))

/** 批量计数：items = [{id, messages?|text?}] → Map(id -> {tokens, method})。 */
export function estimateTokens(items) {
  if (items.length === 0) return new Map()
  if (!existsSync(TOKENIZER_DIR)) {
    throw new Error(`tokenizer dir not found: ${TOKENIZER_DIR}`)
  }
  const result = spawnSync('python', [HELPER, TOKENIZER_DIR], {
    input: JSON.stringify(items),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`tokenizer helper failed (exit ${result.status}): ${(result.stderr || result.stdout).slice(-500)}`)
  }
  const parsed = JSON.parse(result.stdout)
  const map = new Map()
  for (const entry of parsed) map.set(entry.id, { tokens: entry.tokens, method: entry.method })
  return map
}
