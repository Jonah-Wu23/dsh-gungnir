export function sumRange(from, to) {
  if (from > to) return 0
  return ((from + to) * (to - from)) / 2
}
