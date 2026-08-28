import { bucketFor } from './hash.js'
import { matchesAnySegment } from './segments.js'

/**
 * Evaluate a feature flag for a user. Semantics per the README: configured
 * segments decide by exact match; otherwise the rollout bucket decides.
 */
export function evaluate(flag, user) {
  if (flag.segments.length > 0) {
    const matched = matchesAnySegment(user, flag.segments)
    return { enabled: matched, reason: matched ? 'segment' : 'segment-not-matched' }
  }
  const enabled = bucketFor(user.id) < flag.rolloutPercent
  return { enabled, reason: enabled ? 'rollout' : 'rollout-not-selected' }
}
