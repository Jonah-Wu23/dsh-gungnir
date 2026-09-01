#!/usr/bin/env node
// Forward to the source-built CLI bundle via a neutral runtime path (junction
// to the source tree). The bundle resolves its own workspace dependencies from
// the source tree's node_modules, so this shim carries no dependencies of its own.
await import('file:///C:/Users/JonahWu/AppData/Local/dsh-runtime/apps/cli/lib/bin.js')
