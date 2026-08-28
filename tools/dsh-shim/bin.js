#!/usr/bin/env node
// Forward to the source-built CLI bundle. The bundle resolves its own
// workspace dependencies from the source tree's node_modules, so this shim
// carries no dependencies of its own.
await import('file:///E:/AI/dsh-gungnir/deepseek-harness-dsh-v0.1.2-alpha.1/apps/cli/lib/bin.js')
