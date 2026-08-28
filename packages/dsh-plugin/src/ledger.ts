import {
  foldEvent,
  foldEvents,
  type GungnirEvent,
  type GungnirState,
} from '@gungnir/core'

/**
 * Gungnir ledger（ADR-0006）：append-only 事件账本，载体是 ctx.storage 的 KV unit
 * （内置 json backend），不是 session log——DSH persistence 白名单封闭，自定义
 * durable 事件类型无法通过 resume 校验（dsh-interface.md §4）。
 *
 * 纪律：
 * - append 是“写 KV 记录 → fold 推进缓存”两步；fold 抛 FoldError 时缓存标记为
 *   poisoned 并把错误上抛（Let It Fail：绝不静默吞掉坏事件）。
 * - 冷重建：loadAll → 按 seq 升序全量 foldEvents；坏事件直接抛（停在坏事件处）。
 * - 事件以 `${agentId}#${seq(10位补零)}` 为键，保证字典序 == 提交序。
 */

const SEQ_PAD = 10

function seqKey(seq: number): string {
  return String(seq).padStart(SEQ_PAD, '0')
}

export function recordKey(agentId: string, seq: number): string {
  return `${agentId}#${seqKey(seq)}`
}

export interface LedgerRecord {
  readonly key: string
  readonly event: GungnirEvent
}

/** KV 通道的窄接口：与 dsh-storage KvUnit 对齐，测试可注入内存实现。 */
export interface KvChannel {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
  setGlobal(value: unknown): Promise<void>
}

export const LEDGER_UNIT = { name: 'gungnir-ledger', version: 1, tables: ['events'], hasGlobal: true }

export function parseLedgerRecords(raw: Record<string, unknown>, agentId: string): LedgerRecord[] {
  const prefix = `${agentId}#`
  const records: LedgerRecord[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(prefix)) continue
    records.push({ key, event: value as GungnirEvent })
  }
  records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return records
}

/** 单 agent 视角的 ledger：内存缓存 state，append 走 KV。 */
export class AgentLedger {
  private state: GungnirState
  private nextSeq: number
  private poisoned: string | null = null
  // append 串行队列：dry-run fold → 落 KV → 推进内存必须对并发调用方互斥，
  // 否则两个 append 会取到同一个 seq / 同一个 dry-run 基线（loop 事件并发落账的真实场景）
  private appendQueue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly agentId: string,
    private readonly kv: KvChannel,
    state: GungnirState,
    nextSeq: number,
  ) {
    this.state = state
    this.nextSeq = nextSeq
  }

  /** 冷重建：按 key 序全量重放该 agent 的全部事件（strict，坏事件即抛）。 */
  static async open(agentId: string, kv: KvChannel): Promise<AgentLedger> {
    const all = await kv.loadAll()
    const records = parseLedgerRecords(all.tables['events'] ?? {}, agentId)
    const state = foldEvents(records.map((record) => record.event))
    return new AgentLedger(agentId, kv, state, records.length)
  }

  get current(): GungnirState {
    return this.state
  }

  get brokenReason(): string | null {
    return this.poisoned
  }

  /** 事件总数（本 agent）。 */
  get size(): number {
    return this.nextSeq
  }

  /**
   * 追加事件：先干跑 fold（纯函数、零副作用），通过才落 KV 并推进内存。
   * 坏事件在 API 边界被拒（不写存储、不毒化账本），调用方（模型工具）可纠正重试；
   * 落盘失败则内存不推进，同样可重试。v/ts envelope 由本方法统一加盖。
   * 并发调用按到达序串行执行（每 ledger 一条队列）。
   */
  append(event: { type: string } & Record<string, unknown>): Promise<GungnirState> {
    const run = this.appendQueue.then(() => this.appendNow(event), () => this.appendNow(event))
    this.appendQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * loop-state 快照专用通道：transitionsCount 必须在串行队列内读取 fold 派生值
   * （单一真理）。调用方在入队前读 count 会读到 transition 尚未推进的旧值。
   */
  appendLoopState(anchor: { mode: string; turn: number; step: number }): Promise<GungnirState> {
    const run = this.appendQueue.then(
      () => this.appendNow({
        type: 'gungnir/loop-state',
        mode: anchor.mode,
        turn: anchor.turn,
        step: anchor.step,
        transitionsCount: this.state.loopTransitions.length,
      }),
      () => this.appendNow({
        type: 'gungnir/loop-state',
        mode: anchor.mode,
        turn: anchor.turn,
        step: anchor.step,
        transitionsCount: this.state.loopTransitions.length,
      }),
    )
    this.appendQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async appendNow(event: { type: string } & Record<string, unknown>): Promise<GungnirState> {
    if (this.poisoned !== null) {
      throw new Error(`gungnir ledger for ${this.agentId} is poisoned (${this.poisoned}); refusing further appends`)
    }
    const seq = this.nextSeq
    const stamped = { ...event, v: 1, ts: typeof event['ts'] === 'number' ? event['ts'] : Date.now() } as unknown as GungnirEvent
    // dry-run：fold 是纯函数，同态同事件结果确定——通过才允许落盘
    const next = foldEvent(this.state, stamped, seq)
    await this.kv.putRecord('events', recordKey(this.agentId, seq), stamped)
    this.state = next
    this.nextSeq = seq + 1
    return this.state
  }
}

/** 进程内内存 KvChannel（单元测试 / 无 storage 环境的降级）。 */
export class MemoryKv implements KvChannel {
  private readonly tables: Record<string, Record<string, unknown>> = { events: {} }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    return { tables: { events: { ...this.tables['events'] } }, global: null }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.tables[table] ??= {}
    this.tables[table][key] = structuredClone(value)
  }

  async setGlobal(value: unknown): Promise<void> {
    this.tables['#global'] = value as Record<string, unknown>
  }
}
