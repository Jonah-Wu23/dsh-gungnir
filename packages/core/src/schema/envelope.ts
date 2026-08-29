import { z } from 'zod'

/**
 * 事件信封（envelope）：{ v: 1, ts, ...payload }。ts 为 epoch 毫秒，是唯一时间权威
 * （一阶段计划表中 payload 内的 ts 收敛进 envelope，避免双时间源）。
 *
 * 独立成模块：schema/events.ts（协议面）与 schema/passive.ts（被动面）都依赖它，
 * 拆出以避免两者互相导入造成 ESM 循环。
 */
export const EventEnvelopeFieldsSchema = z.object({
  v: z.literal(1),
  ts: z.number().int().nonnegative(),
})
