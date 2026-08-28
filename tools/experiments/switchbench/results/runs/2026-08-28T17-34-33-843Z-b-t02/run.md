# SwitchBench run 2026-08-28T17-34-33-843Z — arch **B** task `t02` seed 1001
- finishReason: `finish-tool`；runError: `none`
- Gate 1: **PASS**（probe=clean / trunk=8/8 / integrity=true / exports=true）
- 指标：wall=250.5s in=70382tok out=7225tok cached=63104 rounds=19 tools=32 waste=31%
- TTFUA: 13.1s / 1 rounds / 0 tools before first useful action
- False Completion: false（claimed=true）
- src 足迹: changed=["/src/keys.js"] added=[] deleted=[]
- HandoffPacket: {"goal_spec":{"goal":"make the repository's test suite pass, conforming to README.md as the authoritative spec","constraints":["only-src","no-new-deps","api-stable","stay-in-workspace"]},"goal_status":{"phase":"branch-search-complete","hypotheses_investigated":0,"selection":"none"},"selected_hypothesis":"","verified_facts":[],"evidence_refs":[],"artifact_refs":[],"unresolved_questions":[],"recommended_next_action":"No hypothesis survived investigation. Investigate the failing suite directly, fix the root cause under src/, then run the suite."}
```
Root cause: `src/keys.js` normalized keys with `key.trim().toLowerCase()`, but the README spec says case is significant — two keys differing only in case must be distinct entries, with normalization being trim-only. The lowercasing collapsed `'Alpha'`/`'alpha'` into one entry and mangled case in both keys tests and cache tests.

Fix: changed `normalizeKey` to trim surrounding whitespace only (`return key.trim()`), matching the authoritative README spec.

Verified: ran `node --test --test-isolation=none` (the sandbox-required in-process mode) — all 8 tests pass, 0 failures. Public exports unchanged (`keys.normalizeKey`, `clock.systemClock`, `cache.createCache`, `api.readThrough`). Only `src/keys.js` was modified.
```
