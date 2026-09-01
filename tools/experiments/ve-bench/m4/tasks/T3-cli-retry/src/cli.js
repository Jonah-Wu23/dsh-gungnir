import { parseArgs } from './args.js'
import { retryWithBackoff } from './retry.js'

export async function main(argv) {
  const { retries } = parseArgs(argv)
  const result = await retryWithBackoff(() => Promise.resolve('ok'), retries)
  console.log(result)
}
