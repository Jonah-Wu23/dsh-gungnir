# @gungnir/switchbench

SwitchBench v0：A-vs-B agent-loop 拓扑实验的 benchmark 与 Baseline 跑批器（实验计划见 [EXPERIMENT.md](EXPERIMENT.md)，冻结载体见 [BENCHMARK.md](BENCHMARK.md)）。隔离纪律：本目录外不产生任何实验产物，不改 `packages/`、`docs/plan/`、DSH 源码树。

## Contract

**做什么**

- 冻结 5 任务 benchmark（Stage 1 集合，Killer = t01）：`tasks/<id>/repo/`（植入故障的零依赖 Node.js repo + 权威 spec + 冻结测试）、`probe.mjs`（模型不可见的原 bug 复现探针）、`manifest.json`（完整性 + API 冻结清单）；ground truth、约束判据、MUST/SHOULD/IRRELEVANT 测试标注全部冻结在 `src/tasks.mjs`。
- `src/verify.mjs`：Gate-1 deterministic verifier——原 bug 不可复现（probe）、主干测试通过（`node --test` TAP 计数）、integrity（src/ 外逐字节未变）、exports（导出名集合未变），四条件全绿才 PASS；另记 src 足迹作纪律证据。
- `src/run-baseline.mjs`：Baseline（普通 DSH，`switchbench-base` profile，无 Gungnir 插件）跑批——工作区在系统临时目录物料化（防 harness 读泄漏），冻结模型 deepseek-v4-flash-0731 @ jiyuan-lvdong，每 run 落 `results/run-<ts>.{json,md}`，session id 反查留档。
- `src/selfcheck.mjs`：验证器非空转自检（pristine 必 FAIL、规范修复副本必 PASS）。

**不做什么**

- 不 mock、不替模型作答、不绕过沙箱；判据不由模型自称完成。
- 不改被测系统；修复回源码 + 重跑 selfcheck。
- 不做统计判决（Day 7 才落 ADR）；token 计数未接（OPEN-5），只记 wall-clock + session id 留档。

## 用法

```bash
node src/freeze.mjs          # repo/manifest 变更后重冻（须记录于 BENCHMARK.md 事故表）
node src/selfcheck.mjs       # 验证器双侧自检（跑批前后均可）
node src/run-baseline.mjs    # Killer Task t01（默认）
node src/run-baseline.mjs t02 t05   # 指定任务
```

凭据：仓库根 `.env` 的 `APIKEY`（或环境变量 `JIYUAN_LVDONG_API_KEY`），勿入库勿打印。

## Known Limitations

1. **工作区读泄漏不可根除**（沙箱 WRITE_RESTRICTED 只限写）：靠临时目录物料化 + 中性命名 + prompt 约束 6 挡顺路探索；刻意绝对路径搜索只能靠 session-log 复盘发现判废。三组架构风险等同。
2. **`node --test` 在 workspace-write 下 EPERM**（子进程隔离的管道被拒）：冻结 prompt 已含环境注记与 `--test-isolation=none` 等价验证路径；harness 侧 trunk 验证不受影响。上游沙箱语义变化则注记作废。
3. **session id 反查**依赖 `~/.dsh/sessions/` 的 cwd 编码目录名（v0.1.2 事实）；上游改名策略需同步 `findSessionId`。
4. **判废 run 永不删除**：`results/void/` 保存泄漏污染与假违规现场（BENCHMARK.md §7 事故表），防止"历史看起来太干净"。
5. 单任务超时 300s；跑批串行（ledger 全局单文件的纪律沿用自一阶段；baseline 本身不写 gungnir ledger，但 dsh session 落盘仍共享 home）。
