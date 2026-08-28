# priority-parse

Task scheduler with numeric priorities.

## Specification (authoritative)

- `parseTask(payload)`: `payload` is `{ id, priority }` where `priority` is a
  string of digits (possibly with surrounding whitespace). The parsed task is
  `{ id, priority }` where **`priority` is a non-negative integer** (parsed with
  radix 10). `parseTask` throws `RangeError` when the trimmed priority is not a
  valid non-negative integer (e.g. `"soon"`, `"-3"`), and `TypeError` when
  `payload` is not an object or `priority` is not a string.
- `compare(taskA, taskB)`: orders **lower priority number first**. `compare`
  receives already-parsed tasks.
- `createQueue()`: `enqueue(task)` / `drain()` / `size()`. `drain()` returns the
  tasks ordered by `compare`, ties broken by **FIFO insertion order**. `drain()`
  must not mutate the queue.
- `runOrder(payloads)`: parses each payload, enqueues into a queue, and returns
  the drained task ids.

**Interaction rule**: the scheduler's ordering contract holds only when priorities
flow through the pipeline as integers. Raw payload strings must never reach the
comparator.

## Public API (must not change)

- `src/parse.js`: `parseTask`
- `src/compare.js`: `compare`
- `src/queue.js`: `createQueue`
- `src/scheduler.js`: `runOrder`
