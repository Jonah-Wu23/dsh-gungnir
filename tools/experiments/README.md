# @gungnir/experiments

一阶段**生死实验**跑批（一阶段计划 §9.3 的 A3）。用真实 headless profile + 真实模型，把 20 个任务各跑一遍完整 Gungnir 闭环，再用 ledger 冷重建出的状态与人工 ground truth 对照，检验"证据驱动进展判定"这条共享生死假设是否成立。二阶段的四组对照实验（Adaptive Loop Spike，二阶段计划 §5）将复用本跑批器框架。

## Contract

**做什么**

- 定义 20 个任务的 ground truth 语料（`src/tasks.mjs`）：10 coding（L2 artifact + L1 exit-code 可判定）、6 research（L2 可判定）、2 research-l4（阶梯强制探针，期望**不**完成）、2 对抗（a19 谎报完成 / a20 不可能命令，期望 BLOCKED）。
- `src/run.mjs`：逐个 spawn `dsh --profile headless "<prompt>"`，抓 session id，从 `~/.dsh/storage/gungnir_ledger.json` 读回记录，`parseLedgerRecords` + `foldEvents` 冷重建状态，算出每任务的 phase / rounds / verdict 数 / evidence 数 / 覆盖率 / 是否与 ground truth 一致，落一份带时间戳的 `results/experiment-<ts>.{json,md}`。
- `src/merge.mjs`：合并多次跑批（每个 taskId 取**最新**一次），产出 `results/report.md` + `results/report.json`，并给出熔断判定（可判定任务一致率 < 70% 即触发一阶段熔断）。

**不做什么**

- 不 mock、不替模型作答、不绕过 sandbox —— 全部走真实 DSH 进程与真实 LLM 通道。
- 不改写被测系统：这里只读 ledger 与产物，修复一律回源码 + 补 destruction 回归。
- 不做性能基准：开销（轮次/verdict/evidence）只作参考，不作验收门槛。

## 用法

```bash
pnpm --filter @gungnir/core build && pnpm --filter dsh-gungnir build   # 必先 build，harness 直接吃 dist
node src/run.mjs                # 跑全部 20 个
node src/run.mjs c01 r11 a19    # 只跑指定任务
node src/merge.mjs              # 汇总 → results/report.md
```

凭据：环境变量 `JIYUAN_LVDONG_API_KEY`，或仓库根 `.env` 里 `APIKEY=...`（`.env` 已 gitignore，切勿入库）。

## 指标

| 指标 | 定义 | 期望 |
|---|---|---|
| 一致率 | verdict 与人工 ground truth 相符的任务占比 | ≥ 70%（低于即熔断） |
| **假验收数** | 世界未满足判据却被判完成的任务数（**权重最高**） | **0** |
| 冷重建成功率 | 从 ledger 重建状态与运行终态一致的比例 | 100% |
| evidence 覆盖率 | 每条 verdict 是否有同轮 evidence 支撑 | 100% |

## Known Limitations

1. **harness 直接 import `packages/*/dist`**（相对路径），因为本沙箱内 `pnpm install` 会被 safe-delete 拦截；workspace 依赖仍声明在 `package.json`，正常环境 install 后可改回裸包名导入。**跑批前必须 build 两个包**，否则会读到旧 dist。
2. **一个 dsh 进程一个任务**，并发为 1；20 任务全量约 20–30 分钟，单任务超时 300s。
3. **ledger 是单文件全局的**（`~/.dsh/storage/gungnir_ledger.json`），跑批之间不隔离；rerun 同一 taskId 由 `merge.mjs` 取时间戳最新者，但并发跑两个 harness 实例会互相污染。
4. **地面真值由人工声明**，coding/research 任务的判据是"客观可观测"（文件存在+内容、命令退出码），但"研究得够不够好"这类质量判断不在本实验范围内——那属于 L4 的能力边界，本实验只用 L2 可判定的 marker 约束。
5. **对抗任务必须模型无关**：内容型对抗（让它写错内容、要求文件缺席）会被模型自我审查绕过，得到的是"世界真的满足了判据"的合法 COMPLETE，不是系统缺陷。a19/a20 因此设计成不依赖模型行为。
