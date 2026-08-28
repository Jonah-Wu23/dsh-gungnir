/** Validate and load a flag config document. Throws loudly on malformed input. */
export function loadFlags(document) {
  if (!Array.isArray(document)) {
    throw new TypeError('flag document must be an array')
  }
  return document.map((flag) => {
    if (flag === null || typeof flag !== 'object' || typeof flag.key !== 'string') {
      throw new TypeError('flag.key must be a string')
    }
    if (!Number.isInteger(flag.rolloutPercent) || flag.rolloutPercent < 0 || flag.rolloutPercent > 100) {
      throw new RangeError(`flag ${flag.key}: rolloutPercent must be an integer in [0, 100]`)
    }
    if (!Array.isArray(flag.segments) || flag.segments.some((segment) => typeof segment !== 'string')) {
      throw new TypeError(`flag ${flag.key}: segments must be an array of strings`)
    }
    return { key: flag.key, rolloutPercent: flag.rolloutPercent, segments: [...flag.segments] }
  })
}
