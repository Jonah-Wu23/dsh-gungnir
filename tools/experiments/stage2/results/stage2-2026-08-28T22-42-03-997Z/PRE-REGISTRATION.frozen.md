# Stage-2 对照实验预注册（四组对照；冻结于跑批前，2026-08-29）

> 依据《二阶段实施详细计划》§5：预注册先于跑批。本文件冻结后，任何改动都在报告的"偏差"节如实记录，不回写本文件。
> 平行实验 SwitchBench v0（ADR-0013）已裁决方案 B 停止投资；本实验裁决的是 **Adaptive Loop v0（方案 A，Baseline-Preserving）能否打过高强度 baseline 而不输质量**。

## 1. 假设与判定门（冻结）

- **H**：Gungnir AdaptiveLoop（三模式 + 确定性 router）在任务成功率不下降的前提下，能显著降低成本/时延/无效步骤。
- **判定门**（计划 §5.4 建议值冻结为正式阈值）：Gungnir 组 task success 不低于 Code-PTC 组（对照基准），**且**满足以下至少两项（均为 Gungnir 相对 Code-PTC 的中位数降幅）：
  - input tokens ↓ ≥ 20%
  - LLM round-trips ↓ ≥ 25%
  - wall-clock latency ↓ ≥ 15%
  - 重复无效步骤（loop repetitions + validation failures 之和）↓ ≥ 30%
- 同时报告相对 DSH Standard 的同口径数字（信息性，不进门）。
- **熔断出口**（计划 §5.5）：打不过 Code/PTC → 暂停替换路线回退方案 B；session 事件语义破坏 → 红线停止（B3 已实测通过，不在本实验重判）。

## 2. 四组配置（冻结）

| 组 | profile | 环境变量 | 说明 |
|---|---|---|---|
| standard | `exp-standard`（base+headless） | 无 | 默认 driver，native 工具呈现 |
| ptc | `exp-standard` | `DSH_TOOLS_MODE=ptc` | Code-PTC 呈现（headless bundle 自带 code-runtime 行；对照基准） |
| workflow | `exp-standard` | 无 | prompt 明示可用 workflow 工具编排（其设计用法；工具在 base 默认挂载） |
| gungnir | `gungnir-loop`（base+headless+dsh-gungnir-loop+dsh-gungnir） | 无 | Adaptive Loop v0 三模式 + 确定性 router + Prove 层 |

模型统一 `deepseek-v4-flash-0731` @ `jiyuan-lvdong`；`DSH_TELEMETRY_DISABLED=1`；权限档 `workspace-write`（继承一阶段口径）；单 run 软预算 600s（SwitchBench §7 事故 #5 口径）。

## 3. 任务集（冻结；6 任务 × 4 组 × 1 seed = 24 run）

多工具序列任务为主（t1–t4），workspace 问答与纯知识任务作对照（t5–t6）。任务定义与 ground truth 谓词见 `tasks.mjs`（冻结副本随 run 存档）；谓词全部确定性（L1 exit_code / L2 artifact 同语义），由跑批器对**所有组**统一判定（Gungnir Verifier 层口径）。

各组 prompt 模板（冻结）：

- baseline 三组：`OBJECTIVE: <objective>\nWork in the current workspace. Produce exactly the required artifacts.`
- workflow 组追加一行：`You may use the workflow tool to orchestrate multi-step work if helpful.`
- gungnir 组：`Objective from the human: <objective>\nDraft a GoalSpec for it (1-5 concrete successCriteria; prefer the lowest verifier level that can prove it) and call gungnir_submit_spec. Then follow the Gungnir round flow (gungnir_plan → execute → gungnir_report → update_goal) until verified completion.`

> 公平性注记（预注册声明）：gungnir 组的 Gungnir 流程指令是其**产品设计用法的一部分**，其 token 开销计入该组；baseline 组不承担此额外指令。谓词与目标在三组间完全一致。

## 4. 指标口径（冻结）

| 指标 | 操作化定义 |
|---|---|
| task success | 跑批后对所有组统一执行 ground truth 确定性谓词（全部通过 = success） |
| wall-clock | 跑批器实测（进程级） |
| LLM round-trips | session log `assistant/message` 事件数 |
| tool calls | session log `tool/call` 事件数 |
| input/output tokens | 官方 tokenizer 离线估计（SwitchBench 口径：请求可见面重建；**系统性下界**——system prompt 与工具 schema 不在 session log，偏差同向作用于所有组）；gungnir 组另记 tokenMeter usage 锚点（stderr 日志）作校准参考，不进门 |
| cache hit | 离线不可观测 → 记 null，不进门（如实标注） |
| validation failures | `tool/result` 携带 isError 的事件数 |
| instruction violations | `tool/result` 文本含 sandbox 拒绝标记（denied / EPERM / WEB_BLOCKED）的事件数 |
| loop repetitions | 与紧邻前一次 `tool/call` 的 (name, arguments) 完全相同的事件数 |
| recovery count | error 结果之后同工具名的后续成功调用次数 |
| 重复无效步骤（进门） | loop repetitions + validation failures |

统计口径：组间中位数对比（n=6，不做显著性检验——预注册效应量阈值替代，沿用计划 §5.4 口径）；单 seed，方差限制如实随档（沿用 SwitchBench scope 惯例）。

## 5. 产物与判定

- 原始数据：`results/stage2-<ts>/rows.jsonl`（每 run 一行：组/任务/指标/事件计数/session 定位）+ 每 run 工作区与 prompt 存档。
- 判定：`report.mjs` 按冻结门输出 PASS/FAIL 与逐项数字 → stage report（B5）与继续/熔断结论（B6）。
