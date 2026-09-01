/**
 * Argument parsing per the README.
 */
export function parseArgs(argv) {
  let retries = 0
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--retry') {
      const value = argv[i + 1]
      if (value === undefined || !/^\d+$/.test(value)) throw new Error('--retry requires a non-negative integer')
      retries = Number(value)
      i += 1
    }
  }
  return { retries }
}
