/**
 * Reads billing records from a JSON lines file.
 */
import { readFileSync } from 'node:fs'

export function readRecords(path) {
  const text = readFileSync(path, 'utf8')
  return text
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}
