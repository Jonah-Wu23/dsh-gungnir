import { parseTask } from './parse.js'
import { createQueue } from './queue.js'

/** Build a queue from raw payloads and return the drained task ids. */
export function runOrder(payloads) {
  const queue = createQueue()
  for (const payload of payloads) {
    queue.enqueue(parseTask(payload))
  }
  return queue.drain().map((task) => task.id)
}
