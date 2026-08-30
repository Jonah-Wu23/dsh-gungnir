import { parseArgs } from './args.js'
import { retryFetch } from './retry.js'

/** Minimal CLI: `node src/cli.js [--retry] <url>`. Wires args + retryFetch. */
export async function main(argv, { fetchFn = globalThis.fetch } = {}) {
  const { retry } = parseArgs(argv)
  const url = argv.slice(2).find((arg) => !arg.startsWith('--'))
  if (url === undefined) throw new TypeError('missing url')
  const response = retry ? await retryFetch(() => fetchFn(url)) : await fetchFn(url)
  return { retry, status: response.status }
}
