# relaypump

A message relay pump. Messages arrive on a persistent queue and are delivered to
a downstream sink. The system must deliver **effectively-once** and preserve
**per-key ordering**.

## Design

- `createQueue()` — a FIFO message queue. Messages are `{ id, key, payload }`.
  `dequeue()` returns the oldest un-acked message; `ack(id)` marks it done;
  `enqueue(msg)` appends; failed messages are re-enqueued for retry.
- `retryWithBackoff()` — retries a transient failure with an exponential backoff
  delay computed from the injected clock.
- `createDedup({ windowMs })` — a sliding-window idempotency guard by message id.
  A message seen within the window is a duplicate and must not be delivered again.
- `createPump({ queue, dedup, sink, clock, processMessage, maxAttempts })` —
  the delivery loop: dequeue → skip duplicates → process → ack + emit, or requeue
  with backoff on failure.
- `createSink()` — records delivered messages in order and reports duplicates
  and failed messages.

## Guarantees (authoritative)

1. **Effectively-once**: each message id is delivered to the sink at most once,
   even when a delivery attempt fails after the downstream has already accepted
   the message (retry must not re-deliver).
2. **Per-key ordering**: for any two messages with the same `key`, the earlier
   enqueued one is delivered before the later one, even across retries.

## Public API

`src/index.js` exports `createQueue`, `retryWithBackoff`, `createDedup`,
`createPump`, and `createSink`. Keep these exports unchanged.
