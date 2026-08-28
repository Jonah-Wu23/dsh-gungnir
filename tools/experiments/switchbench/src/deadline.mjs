/**
 * deadline.mjs — 单任务 deadline 的单一来源。
 * 冻结修正：300s → 600s（BENCHMARK.md §7 事故 #5，任何 Stage 1 run 之前经用户确认）。
 * 软 deadline 口径：deadline 在每次模型请求发起前检查，最后一个进行中的请求可越过
 * 预算线收口，实际 wall 如实记录。
 */
export const TASK_TIMEOUT_MS = 600_000
