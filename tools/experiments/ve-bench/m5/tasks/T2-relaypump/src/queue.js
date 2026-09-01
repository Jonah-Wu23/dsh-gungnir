/**
 * FIFO message queue. Messages are { id, key, payload }. dequeue removes and
 * returns the oldest message whose id has not been finalized; ack finalizes a
 * message; failed messages are put back on the queue (appended at the tail)
 * for a later retry.
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
    pending() {
      return entries.filter((entry) => !done.has(entry.id))
    },
  }
}
