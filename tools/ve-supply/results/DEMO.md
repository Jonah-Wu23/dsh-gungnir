# B2 真实演示记录（真实 profile · 双侧裁决）

> 2026-08-30 · 演示基线 `tools/ve-supply/demo/`（task 基底 + 两份契约）。目的：证明供给闭环在真实交付物上工作——健康不误杀、注入病必检出、沙箱外判据诚实标注。会话日志定位：`~/.dsh/sessions/--C-Users-JonahWu-AppData-Local-Temp-ve-supply-demo-real--/session-78f5d39f-eb68-49af-ad5a-e0b3958c1328/session.jsonl.zstd`。

## 任务与真实执行

- 任务：修复 `src/pipeline.js`（exportPipeline 校验承重）+ 新建 `src/report.js`（formatReport 按 `docs/FORMAT.md`）。
- 真实执行：`dsh --profile exp-standard "$(cat prompt.txt)"`（deepseek-v4-flash-0731，cwd = 派发点工作区 `ve-supply-demo-real`，baseline commit `cb39af47`）。模型交付 10/10 测试全绿，`src/validate.js` 与 test 未改动。
- 环境事实：模型在 DSH sandbox 内跑 `node --test` 遇子进程 spawn EPERM（SwitchBench Day 1 已知边界），用 `--test-isolation=none` 完成等价验证；判定器在 sandbox 外跑 `node --test` 不受影响。

## 场景 1 · 健康交付 → PASS（不误杀）

命令：

```text
node tools/ve-supply/run-supply.mjs --contract tools/ve-supply/demo/contract-healthy.json \
  --workspace <ve-supply-demo-real> --session <ve-supply-demo-real> --label real-healthy
```

结果目录 `2026-08-30T16-41-49-015Z-real-healthy/`：
- **stackVerdict = PASS**；供给覆盖：M-A/M-B/M-D applied，M-C not-applied（无沙箱外判据，如实）。
- M-A：trunk-path probe 全过（隐藏输入 0 失败）。
- M-B：`c1-suite: buggy=FAIL fixed=PASS → BUG_DISCRIMINATING`（`node --test` replay 到 git 快照必 FAIL，判别性见证成立）。
- M-D：grounding 从真实 session log 提取后 0 违规（agent 写 `src/report.js` 前确读 `docs/FORMAT.md`）。
- S1：无冲突。

## 场景 2 · 注入病（绕开主干）→ FAIL（检出 + 证据链）

命令（交付物复制到 `ve-supply-demo-diseased` 后注入"校验结果被丢弃、非法行泄漏"，裁决沿用同一 session tool-log）：

```text
node tools/ve-supply/run-supply.mjs --contract tools/ve-supply/demo/contract-healthy.json \
  --workspace <ve-supply-demo-diseased> --tool-log <real-healthy>/tool-log.jsonl --label real-diseased
```

结果目录 `2026-08-30T16-42-50-257Z-real-diseased/`：
- **stackVerdict = FAIL**，证据链含 trunk-path probe 失败明细：
  - `medicine: invalid rows leaked into exported: 7`
  - `medicine: rejectedCount expected 7, got 0`
  - `criterion c1-suite (exit_code): FAIL`
  - `medicine: c1-suite: buggy=FAIL fixed=FAIL → FIX_FAILED`（交付物在自身状态下即失败，证据无效——M-B 语义正确）

## 场景 3 · M-C/M-D 演示（sandbox-external 判据 + 真实 session grounding）→ UNVERIFIABLE

命令：

```text
node tools/ve-supply/run-supply.mjs --contract tools/ve-supply/demo/contract-full.json \
  --workspace <ve-supply-demo-real> --session <ve-supply-demo-real> --label real-full-supply
```

结果目录 `2026-08-30T16-43-24-507Z-real-full-supply/`：
- **stackVerdict = UNVERIFIABLE**（健康交付 + 含沙箱外判据 c3-loss 的契约 → 终局非完全 PASS，诚实标注，非误杀）；供给覆盖**四药方全 applied**。
- M-C：`unverifiableIds:["c3-loss"]`、`finalNotFullyPass:true`。
- M-D：真实 session log 提取后 0 违规；M-B 仍 `BUG_DISCRIMINATING`。

## 与计划 §3 的对账

| 计划验收 | 结果 |
|---|---|
| 健康交付必须 PASS（不误杀） | ✅ PASS |
| 供给覆盖报告四药方全 applied | ✅ 场景 3（含沙箱外判据的契约）；场景 1 如实记 M-C not-applied（无沙箱外判据，不假装） |
| 注入病必须 FAIL 且证据链含 trunk-path probe 失败明细 | ✅ FAIL + 明细 |
| M-C/M-D 演示：sandbox-external → 终局非完全 PASS；tool-log 从真实 session log 提取后跑 grounding | ✅ UNVERIFIABLE + 0 违规 |

**Not verified**：演示为单任务单 seed（n=1）；模型在沙箱内未能自然跑通 `node --test` 完整命令（用 `--test-isolation=none` 等价验证）——判定侧不受影响但属环境事实；M-D 只证明时序成立，不证明"读了且用了"（Let It Go 边界）；M-A 模板覆盖 1 个现役模板（pipeline-validation）。
