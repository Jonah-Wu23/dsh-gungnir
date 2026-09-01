/**
 * Delivery pump: dequeue → claim → deliver → ack, or requeue with backoff on
 * failure. The dedup claim is recorded before delivery so a retry of an
 * already-delivered message is suppressed; failed deliveries are re-enqueued
 * at the front to preserve per-key order.
 */
import { retryWithBackoff } from './retry.js'

export function createPump({ queue, dedup, sink, clock, processMessage, maxAttempts = 3 }) {
  return {
    run(steps = Infinity) {
      for (let i = 0; i < steps; i++) {
        const message = queue.dequeue()
        if (message === null) break
        if (message.retryAt !== undefined && clock.now() < message.retryAt) {
          queue.requeueFront(message)
          continue
        }
        if (dedup.isDuplicate(message.id, clock.now())) {
          queue.ack(message.id)
          continue
        }
        dedup.record(message.id, clock.now())
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
          queue.requeueFront(message)
          continue
        }
        queue.ack(message.id)
      }
    },
  }
}
