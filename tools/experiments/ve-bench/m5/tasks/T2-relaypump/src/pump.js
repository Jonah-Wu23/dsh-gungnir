/**
 * Delivery pump: dequeue → skip duplicates → deliver → ack + record, or requeue
 * with backoff on failure. The delivery attempt is recorded in the sink before
 * the downstream is called; the dedup guard is recorded only after a successful
 * delivery.
 */
import { retryWithBackoff } from './retry.js'

export function createPump({ queue, dedup, sink, clock, processMessage, maxAttempts = 3 }) {
  return {
    run(steps = Infinity) {
      for (let i = 0; i < steps; i++) {
        const message = queue.dequeue()
        if (message === null) break
        if (message.retryAt !== undefined && clock.now() < message.retryAt) {
          queue.requeue(message)
          continue
        }
        if (dedup.isDuplicate(message.id, clock.now())) {
          queue.ack(message.id)
          continue
        }
        sink.emit(message)
        const ok = processMessage(message)
        if (!ok) {
          message.attempts += 1
          if (message.attempts >= maxAttempts) {
            queue.ack(message.id)
            sink.failed(message)
            continue
          }
          message.retryAt = clock.now() + retryWithBackoff(clock).delayFor(message.attempts)
          queue.requeue(message)
          continue
        }
        queue.ack(message.id)
        dedup.record(message.id, clock.now())
      }
    },
  }
}
