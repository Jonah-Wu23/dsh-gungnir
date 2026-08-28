# SwitchBench run 2026-08-28T17-24-57-582Z — arch **A** task `t02` seed 1001
- finishReason: `finish-tool`；runError: `none`
- Gate 1: **PASS**（probe=clean / trunk=8/8 / integrity=true / exports=true）
- 指标：wall=305.3s in=39215tok out=2845tok cached=32512 rounds=15 tools=28 waste=36%
- TTFUA: 3.1s / 1 rounds / 0 tools before first useful action
- False Completion: false（claimed=true）
- src 足迹: changed=["/src/keys.js"] added=[] deleted=[]
```
Root cause: `src/keys.js` normalized keys with `.trim().toLowerCase()`, which made keys case-insensitive and collided 'Alpha'/'alpha'. This violated the README spec ("Case is significant: two keys that differ only in case are two distinct entries") and caused 3 test failures (2 in keys.test.js, 1 in cache.test.js).

Fix: changed `normalizeKey` to only trim surrounding whitespace (`return key.trim()`), dropping the `.toLowerCase()` call. The exported name `normalizeKey` is unchanged, and no other files were modified. Verified with `node --test --test-isolation=none`: 8/8 tests pass.
```
