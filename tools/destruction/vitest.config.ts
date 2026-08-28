import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 破坏用例要 spawn 子进程，放宽单文件超时
    testTimeout: 30_000,
  },
})
