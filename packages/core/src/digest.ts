import { createHash } from 'node:crypto'

/**
 * 确定性 digest 工具。evidence/verdict 的大内容只存 digest + locator，
 * 不整体入 ledger（对齐 DSH spill 思路）。digest 必须对相同输入跨平台稳定。
 */

/** 规范化 JSON：对象键递归排序、丢弃 undefined，保证相同逻辑内容产出相同字节。 */
export function canonicalJson(value: unknown): string {
  return serialize(value)
}

function serialize(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'null'
  const ty = typeof value
  if (ty === 'boolean' || ty === 'number') return JSON.stringify(value)
  if (ty === 'string') return JSON.stringify(value)
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (Array.isArray(value)) {
    const items = value.map((item) => serialize(item))
    return `[${items.join(',')}]`
  }
  if (ty === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort()
    const parts = keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`)
    return `{${parts.join(',')}}`
  }
  // function / symbol 等不可序列化值：折叠为占位（ledger payload 本就要求 JSON-safe）
  return '"[unserializable]"'
}

/** 对任意 JSON-safe 值计算稳定 sha256（hex）。 */
export function sha256Of(value: unknown): string {
  return sha256OfString(canonicalJson(value))
}

export function sha256OfString(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
