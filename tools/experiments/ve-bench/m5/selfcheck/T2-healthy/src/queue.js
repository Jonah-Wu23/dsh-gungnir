/**
 * FIFO message queue. dequeue removes the oldest unfinalized message; failed
 * messages are re-enqueued at the front (requeueFront) so per-key order is
 * preserved across retries.
 */
export function createQueue() {
  const entries = []
  const done = new Set()
  return {
    enqueue(message) {
      entries.push({ ...message, attempts: message.attempts ?? 0 })
    },
    dequeue() {
      for (let i = 0; i < entries.length; i++) {
        if (!done.has(entries[i].id)) return entries.splice(i, 1)[0]
      }
      return null
    },
    ack(id) {
      done.add(id)
    },
    requeue(message) {
      entries.push(message)
    },
    requeueFront(message) {
      entries.unshift(message)
    },
    pending() {
      return entries.filter((entry) => !done.has(entry.id))
    },
  }
}
