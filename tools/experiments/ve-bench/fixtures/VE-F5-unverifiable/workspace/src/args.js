/** Parse CLI args. Returns { retry: boolean }. `--retry` enables auto-retry. */
export function parseArgs(argv) {
  return { retry: argv.slice(2).includes('--retry') }
}
