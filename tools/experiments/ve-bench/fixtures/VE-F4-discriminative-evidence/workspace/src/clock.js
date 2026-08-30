/** Injectable clock seam. The real clock; tests pass their own `{ now() }`. */
export function systemClock() {
  return { now: () => Date.now() }
}
