/**
 * Delivery sink: records each delivery attempt in order and flags duplicates
 * and failed (abandoned) messages.
 */
export function createSink() {
  const delivered = []
  const failed = []
  return {
    emit(message) {
      delivered.push(message.id)
    },
    failed(message) {
      failed.push(message.id)
    },
    deliveredIds() {
      return [...delivered]
    },
    failedIds() {
      return [...failed]
    },
    hasDuplicate() {
      const seen = new Set()
      for (const id of delivered) {
        if (seen.has(id)) return true
        seen.add(id)
      }
      return false
    },
  }
}
