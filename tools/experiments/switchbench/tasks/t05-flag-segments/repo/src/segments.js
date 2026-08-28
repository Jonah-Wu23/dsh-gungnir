/**
 * Segment matching. Per the README a user matches a segment only when one of
 * the user's segment names is exactly equal (full string equality) to the
 * configured segment name.
 */
export function matchesAnySegment(user, segmentNames) {
  return segmentNames.some((segment) => user.segments.some((own) => own.includes(segment)))
}
