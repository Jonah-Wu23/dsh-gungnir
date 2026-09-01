# Verification in this environment

This workspace's sandbox denies `node --test`' default isolation (per-file child spawn is blocked with EPERM). Run the suite in-process instead:

```
node --test --test-isolation=none
```
