/**
 * Gungnir 错误类型。strict replay 的文化：畸形事件、断序、非法转换立即抛错，
 * 停在首个坏事件处——绝不静默跳过或猜测修复（对齐 DSH goal fold 文化）。
 */

export class FoldError extends Error {
  /** 事件流中首个坏事件的下标（0-based） */
  readonly eventIndex: number
  /** 坏事件的 type（若可辨认；schema 解析失败时为 null） */
  readonly eventType: string | null
  /** 机器可读的拒绝原因码 */
  readonly code: string

  constructor(eventIndex: number, eventType: string | null, code: string, message: string) {
    super(`fold error at event #${eventIndex}${eventType ? ` (${eventType})` : ''} [${code}]: ${message}`)
    this.name = 'FoldError'
    this.eventIndex = eventIndex
    this.eventType = eventType
    this.code = code
  }
}

export class ReconcileError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`reconcile error [${code}]: ${message}`)
    this.name = 'ReconcileError'
    this.code = code
  }
}
