/**
 * Money helpers. All amounts are integer cents; this helper rounds a fractional
 * cent amount to the nearest integer cent, halves up (towards +infinity).
 */
export function roundHalfUpCents(x) {
  return Math.floor(x + 0.5)
}
