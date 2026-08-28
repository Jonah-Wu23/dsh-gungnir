# flag-segments

Feature-flag evaluation with deterministic rollout buckets.

## Specification (authoritative)

- `loadFlags(document)`: validates an array of `{ key, rolloutPercent, segments }`
  and returns defensive copies. `rolloutPercent` must be an integer in `[0, 100]`
  (`RangeError` otherwise); `key` must be a string and `segments` an array of
  strings (`TypeError` otherwise).
- `stableHash(text)`: 32-bit FNV-1a over the UTF-8 bytes of `text`, deterministic
  across processes.
- `bucketFor(userId, buckets = 100)`: `stableHash(userId) % buckets`.
- `matchesAnySegment(user, segmentNames)`: a user matches **only when one of the
  user's segment names is exactly equal** (full-string equality, case-sensitive)
  to one of the configured segment names. Substring or partial matching is a
  specification violation.
- `evaluate(flag, user)`:
  - If `flag.segments` is non-empty, membership is decided **by exact segment
    match only**; `rolloutPercent` is ignored. Returns
    `{ enabled, reason: 'segment' | 'segment-not-matched' }`.
  - Otherwise the rollout decides: `enabled = bucketFor(user.id) < flag.rolloutPercent`,
    `reason: 'rollout' | 'rollout-not-selected'`.

## Public API (must not change)

- `src/hash.js`: `stableHash`, `bucketFor`
- `src/segments.js`: `matchesAnySegment`
- `src/flags.js`: `evaluate`
- `src/config.js`: `loadFlags`
