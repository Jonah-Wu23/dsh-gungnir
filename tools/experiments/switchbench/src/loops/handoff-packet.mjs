/**
 * handoff-packet.mjs — 方案 B 的 SafePoint 交接载体（EXPERIMENT.md §4，最小 schema 冻结）。
 *
 * 只允许 8 个字段；禁止传递 BranchSearchLoop 内部对象、scheduler state、完整
 * CoT、缓存、整棵 branch tree、锁。ExecutionLoop 接班时唯一可依赖的就是这个包。
 */

const PACKET_FIELDS = [
  'goal_spec',
  'goal_status',
  'selected_hypothesis',
  'verified_facts',
  'evidence_refs',
  'artifact_refs',
  'unresolved_questions',
  'recommended_next_action',
] /** 冻结字段序（§4） */

/**
 * 构造并校验 HandoffPacket（恰好 8 个字段，形状不符即抛错——Let It Fail，
 * 绝不带病交接）。
 */
export function buildHandoffPacket(parts) {
  const packet = {
    goal_spec: parts.goal_spec,
    goal_status: parts.goal_status,
    selected_hypothesis: parts.selected_hypothesis,
    verified_facts: parts.verified_facts,
    evidence_refs: parts.evidence_refs,
    artifact_refs: parts.artifact_refs,
    unresolved_questions: parts.unresolved_questions,
    recommended_next_action: parts.recommended_next_action,
  }
  validateHandoffPacket(packet)
  return packet
}

export function validateHandoffPacket(packet) {
  const keys = Object.keys(packet)
  const missing = PACKET_FIELDS.filter((field) => !keys.includes(field))
  const extra = keys.filter((key) => !PACKET_FIELDS.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`HandoffPacket schema violation: missing=[${missing}] extra=[${extra}] (frozen 8-field schema)`)
  }
  if (typeof packet.selected_hypothesis !== 'string') throw new Error('HandoffPacket: selected_hypothesis must be string')
  for (const field of ['verified_facts', 'evidence_refs', 'artifact_refs', 'unresolved_questions']) {
    if (!Array.isArray(packet[field]) || packet[field].some((item) => typeof item !== 'string')) {
      throw new Error(`HandoffPacket: ${field} must be string[]`)
    }
  }
  if (typeof packet.recommended_next_action !== 'string') throw new Error('HandoffPacket: recommended_next_action must be string')
  if (packet.goal_spec === null || typeof packet.goal_spec !== 'object') throw new Error('HandoffPacket: goal_spec must be object')
  if (packet.goal_status === null || typeof packet.goal_status !== 'object') throw new Error('HandoffPacket: goal_status must be object')
}

export const PACKET_FIELD_ORDER = PACKET_FIELDS
