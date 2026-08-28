# @gungnir/destruction

Gungnir **破坏测试** harness（一阶段计划 §9.2 的 D-1~D-6 矩阵）。破坏测试在本项目是第一等用例：进程被杀、重启、环境漂移、模型谎报 —— 这些不是异常路径，是默认要扛住的现实。二阶段起新增 loop 破坏用例（D-11 转换中途 kill / D-12 振荡注入 / D-13 resume/fork 语义等价，见二阶段计划 §7）。

## Contract

**做什么**

| 用例 | 文件 | 覆盖 |
|---|---|---|
| D-1 中途 SIGKILL | `tests/d1-d4-rebuild.test.ts` | 杀进程后从 ledger 精确重建已提交状态；下一次 append 落在正确 seq |
| D-2 环境漂移 / 断序 | `tests/d1-d4-rebuild.test.ts`、`d2-d6-engine.test.ts` | 畸形事件、断序、非法转换 → `FoldError` 停在坏事件处，绝不静默跳过 |
| D-3 重复失败 | `tests/d3-d5-breakers.test.ts` | 同一 errorSignature → RETRY → 预算耗尽后 `BLOCKED(stuck)`，**永不 COMPLETE**；重投影同一 stepId 不能绕过预算 |
| D-4 重启续跑 | `tests/d1-d4-rebuild.test.ts` | 冷重建与运行终态一致 |
| D-5 session 压缩 | `tests/d3-d5-breakers.test.ts` | 压缩后 `ctx.storage` ledger 完好，重建逐字节一致且可继续 append |
| D-6 引擎闭环 | `tests/d2-d6-engine.test.ts` | claim≠evidence、阶梯强制、熔断 |

外加三份 **verifier 契约测试**（这些是"判定本身会不会撒谎"的护栏）：

- `tests/l1-exit-code.test.ts` —— L1 确定性判定；**执行器不可用时必须 INCONCLUSIVE，绝不伪造成功**。
- `tests/l2-artifact.test.ts` —— L2 产物判定；含 ADR-0009 的假验收回归（`mustExist:false` 时文件存在即 FAIL）。
- `tests/l4-rubric.test.ts` —— L4 语义判定；无评审对象 → INCONCLUSIVE，且经引擎后 PASS 必须降级为 PARTIAL、推不出 COMPLETE。

**不做什么**

- 不做离线 mock 联调：需要真实模型通道的部分一律走 `llm-smoke.mjs`（真机）或 `tools/experiments`（真实 profile），不在这里用假 LLM 冒充。
- 不断言性能/时延。

## 用法

```bash
pnpm --filter @gungnir/core build && pnpm --filter dsh-gungnir build
pnpm --filter @gungnir/destruction test        # 24 用例 / 6 文件
pnpm --filter @gungnir/destruction typecheck
```

真机 L4 冒烟（需要凭据，不入 CI）：

```bash
node llm-smoke.mjs     # 读 GUNGNIR_API_KEY 或仓库根 .env 的 APIKEY
```

它验证的是"真实模型通道下 L4 判 PASS → 引擎降级为 PARTIAL → satisfied=false → 不 COMPLETE"。

## Known Limitations

1. `test` 脚本依赖 `pnpm --filter dsh-gungnir build`，因为测试吃的是 `dist`；本沙箱内 `pnpm -r` 会被 safe-delete 拦截，需逐包直调 `vitest run`。
2. D-1 的 SIGKILL 用例在 win32 上以"模拟 kill（进程外写入 + 立即重建）"实现，等价于强杀后重启的语义，但不是真的 `kill -9` 子进程；Linux/macOS 上语义更强。
3. `llm-smoke.mjs` 与 CI 隔离：它需要外部凭据，且断言依赖模型具体打分，只作人工复核工具。
4. 本 harness 覆盖的是**单机、单进程、单 session** 的破坏面；多会话并发写同一 ledger 的竞态未覆盖（ledger 是单文件，无并发契约）。
