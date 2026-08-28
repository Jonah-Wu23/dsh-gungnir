import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { KvChannel } from 'dsh-gungnir/ledger.js'

/**
 * 文件落盘的 KvChannel fixture：模拟 dsh-storage-json 的 KV 语义
 * （loadAll / putRecord / setGlobal），跨进程共享同一 JSON 文件——
 * D-1/D-4 用真 kill / 真重启的跨进程重建，不用进程内假账本。
 * 这不是 DSH 后端的 mock 联调：ADR-0006 的 ledger 只依赖 KvChannel 窄接口，
 * 本 fixture 是破坏 harness 自己的测试后端。
 */

export class FileKv implements KvChannel {
  private constructor(private readonly path: string) {}

  static open(path: string): FileKv {
    if (!existsSync(path)) writeFileSync(path, JSON.stringify({ tables: { events: {} }, global: null }))
    return new FileKv(path)
  }

  private read(): { tables: Record<string, Record<string, unknown>>; global: unknown } {
    return JSON.parse(readFileSync(this.path, 'utf8')) as { tables: Record<string, Record<string, unknown>>; global: unknown }
  }

  private write(state: { tables: Record<string, Record<string, unknown>>; global: unknown }): void {
    writeFileSync(this.path, JSON.stringify(state))
  }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    const state = this.read()
    return { tables: Object.fromEntries(Object.entries(state.tables).map(([k, v]) => [k, { ...v }])), global: state.global }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    const state = this.read()
    state.tables[table] ??= {}
    state.tables[table][key] = value
    this.write(state)
  }

  async setGlobal(value: unknown): Promise<void> {
    const state = this.read()
    state.global = value
    this.write(state)
  }

  /** 破坏注入：绕过 ledger 直接改原始存储（写坏事件/截断）。 */
  corrupt(mutate: (tables: Record<string, Record<string, unknown>>) => void): void {
    const state = this.read()
    mutate(state.tables)
    this.write(state)
  }
}
