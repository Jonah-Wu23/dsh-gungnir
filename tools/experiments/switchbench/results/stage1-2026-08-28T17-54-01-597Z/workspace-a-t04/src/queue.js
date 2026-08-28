import { compare } from './compare.js'

/**
 * Priority queue: lower priority first, ties broken by FIFO insertion order.
 * `drain()` does not mutate the queue.
 */
export function createQueue() {
  let nextSeq = 0
  const items = []

  return {
    enqueue(task) {
      items.push({ task, seq: nextSeq++ })
    },
    drain() {
      return items
        .slice()
        .sort((a, b) => compare(a.task, b.task) || a.seq - b.seq)
        .map((item) => item.task)
    },
    size: () => items.length,
  }
}
