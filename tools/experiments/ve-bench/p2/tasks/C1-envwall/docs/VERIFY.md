# Verification in this environment

This workspace's sandbox denies `node --test`'s default isolation mode (it spawns
a child process per test file with piped stdio, which is blocked with `spawn
EPERM`).

Run the suite in-process instead:

```
node --test --test-isolation=none
```

The pass/fail results are identical to the default runner; only the isolation
differs.
