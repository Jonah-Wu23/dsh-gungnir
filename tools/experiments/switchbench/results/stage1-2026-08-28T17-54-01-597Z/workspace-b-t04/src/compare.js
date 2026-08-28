/**
 * Compare two parsed tasks: lower priority number first. Per the README,
 * `compare` receives already-parsed tasks (priority is an integer).
 */
export function compare(taskA, taskB) {
  if (taskA.priority < taskB.priority) return -1
  if (taskA.priority > taskB.priority) return 1
  return 0
}
