/** 32-bit FNV-1a over UTF-8 bytes; deterministic across processes. */
export function stableHash(text) {
  const bytes = Buffer.from(text, 'utf8')
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Map a user id onto one of `buckets` rollout buckets. */
export function bucketFor(userId, buckets = 100) {
  return stableHash(userId) % buckets
}
