# Gungnir SwitchBench v0 实验计划（冻结稿）

> **H1: Some practically useful agent-loop topologies cannot be cleanly represented as strategies inside a single adaptive driver without material loss of performance, efficiency, or architectural simplicity.**

本实验只裁决 H1。H1 是方案 B（同一 Goal 运行中切换 Loop 实现）的生死门：H1 不成立，方案 A（单 Meta-Loop + Strategy 切换）直接胜出，H2（能否安全交接）、H3（能否自动判断切换时机）都不必再研究。

## 1. 问题重述

DSH 已经解决"loop 可替换"：公共 `Agent` 接口与默认 `agent-loop` 分离，`dispose()` / `resume()` / session persistence 都是现成积木。方案 B 剩下的唯一主张是**运行中的控制器编排与交接**（Loop ≈ runtime resource），对阵方案 A 的**策略切换**（Loop ≈ policy）。本实验的核心问题：

> **相较于最强的单一 Adaptive Meta-Loop，运行时切换异构 Agent Loop，能否在不降低 Verified Goal Success 和指令遵循的前提下，以更少 Token、更少模型往返、更短行动延迟和更少无效操作完成同一目标？**

方法：找一个真正异构的 Loop 算法，分别以"方案 A Strategy"和"方案 B 独立 Loop + SafePoint 交接"各实现一遍对照。测试对象故意不选 FAST / THINK / VERIFY（太容易 Strategy 化，实验天然偏向 A）。选 **Branch Search**：多假设并行调查 → 各持独立状态与证据 → 比较收敛 → 进入执行。它最难干净塞进统一 turn/step 契约，又简单到 7 天能写完。

### 方案定义

**方案 A：Adaptive Meta-Loop + Strategy Switching**

- 核心抽象：**一个 Agent，一套控制器**。session 生命周期内 driver 实例稳定，运行中切换的是 Loop Strategy（REFLEX / EXECUTE / DELIBERATE / VERIFY / RECOVER / BRANCH …）。
- 立场：**Loop ≈ Policy**。Gungnir Meta-Loop 恒定拥有 Agent、scope、driver、lifecycle；Strategy 只在它写死的"物理规律"（turn/step 语义、事件顺序、tool continuation、cancellation）内部活动，改得了行为策略，替换不了承载自己的 runtime。
- 第三方 Loop 想加入，必须改造成 Strategy；Strategy Contract 的厚度就是这套架构表达力的上限。
- 切换谱系位置：Level 1–2（Policy / Execution Strategy Switching）。

**方案 B：Loop Orchestration（SafePoint 物理切换）**

- 核心抽象：**一个 Goal，多个可交接控制器**。运行中到达 SafePoint（无 open model request / tool call / step，durability checkpoint 已提交）后真正更换 Loop 实现：旧控制器 detach → HandoffPacket 薄交接 → 新控制器接班。Goal 连续性不依赖任何 Loop 的内部状态，只依赖 GoalSpec / GoalStatus / Evidence。
- 立场：**Loop ≈ Runtime Resource**。Supervisor 握有编排权，控制器本体成为运行时变量；极端情况下控制器自身腐化也能"烧毁重起"（control-plane reboot），Strategy 架构做不到这一点，因为 RECOVER 仍运行在已经坏掉的 runtime 里。
- 边界声明（防夸大）：DSH 已解决"启动前换 loop"，官方架构明示 agent loop 可从配置替换（`dsh-interface.md` §3，`dsh-agent-loop` 之外不依赖 concrete loop；树外 loop 包进 bundles 层栈的机制待 OPEN-7 实证）。B 不把"能插上另一个 loop"算作创新，主张**只有**"同一 Goal 运行中的编排与交接"。B 也不承诺支持任意 Loop：符合 Gungnir LoopModule 协议的可动态调度，其余经 Adapter 接入。
- 任意时刻热换不做（pending tool call / AbortSignal / inbox claim 会制造幽灵状态），只做 SafePoint 切换。谱系位置：Level 3–4（Loop Module / Physical Driver Switching）。

| 维度 | 方案 A | 方案 B |
|---|---|---|
| 核心抽象 | 一个 Agent，一套控制器 | 一个 Goal，多个可交接控制器 |
| Loop 的定位 | Policy | Runtime Resource |
| Session 内 Policy 切换 | ✅ | ✅ |
| Session 内更换 Loop 实现 | ❌ | ✅（核心主张，仅 SafePoint） |
| Agent 生命周期归属 | Meta-Loop 恒定 | 随交接转移 |
| 第三方 Loop 接入 | 改造成 Strategy | LoopModule 协议 / Adapter |
| Goal 连续性来源 | 天然（控制器不变） | GoalSpec / GoalStatus / Evidence + HandoffPacket |
| 主要风险 | Strategy 膨胀成 Loop VM | 状态迁移泥潭、交接税 |

本实验的存在理由：A 的代价（架构变形）和 B 的独有收益（运行中换控制器）目前都只是口头论证，SwitchBench 把它们变成可测指标（§7 第 3、4 类）。

## 2. 非目标（本轮全砍）

- 自动 Loop Router：H3 整体排除，SafePoint 由实验脚本预先规定（"调查完成后切到 ExecutionLoop"），不污染 H1。
- 通用 Loop 序列化协议、热切换 UI、复杂 persistence、任意时刻切换、第三方 Loop Adapter。
- 不裁决 H2：B 的交接税只作观察指标，作下一轮是否研究 H2 的输入。

## 3. 实验组

| 组 | 架构 | 说明 |
|---|---|---|
| Baseline | 普通 DSH | 经 `tools/dsh-shim`（v0.1.2-alpha.1 源码构建）+ headless profile，普通 ReAct |
| A | UnifiedDriver + BranchSearchStrategy | Branch Search 硬塞进统一 turn/step/context/tool scheduling/state ownership 契约，做对方案 A 最公平、最强的实现 |
| B | BranchSearchLoop → SafePoint → HandoffPacket → ExecutionLoop | Branch Search 自持 frontier / branch state / 并发 / 收敛，到预定 SafePoint 后薄交接 |

两条关键设计：

- **UnifiedDriver 是实验内最小统一契约宿主**，代理未来的 Adaptive Meta-Loop。二阶段 M0 尚未启动，本实验不依赖、不等待、不抢占它的产物；结论统一标注"UnifiedDriver 代理"口径，日后移植到真 Meta-Loop 需复测。
- ExecutionLoop 与 UnifiedDriver 是同一份代码，B 组拿它当接班 loop 用。这样 A 和 B 的唯一差异就是"Branch Search 住在哪里"，其余变量全部对齐。
- Baseline 只回答"两种改进整体有没有用"，真正的判决看 A vs B。

## 4. HandoffPacket（最小 schema，冻结）

只允许 8 个字段：

```json
{
  "goal_spec": {},
  "goal_status": {},
  "selected_hypothesis": "",
  "verified_facts": [],
  "evidence_refs": [],
  "artifact_refs": [],
  "unresolved_questions": [],
  "recommended_next_action": ""
}
```

禁止传递：BranchSearchLoop 内部对象、scheduler state、完整 CoT、缓存、整棵 branch tree、锁。长期可信的是 GoalSpec / GoalStatus / Evidence，Plan 只是临时投影。B 连这么薄的状态都接不了班，将来做通用架构必然陷进状态迁移泥潭。

## 5. 任务集

- 每个任务必须三段俱全：**探索/不确定 → 明确执行 → 确定性验证**。典型形态：人工植入故障的小型 repo，表面 ≥3 个合理 root-cause 假设，调查定位 → 改代码 → 跑确定性测试。杜绝"改 README typo"这类不需要异构 Loop 的任务。
- ground truth 人工声明、事先冻结；成功一律由 L1 deterministic verifier 裁决（沿用一阶段生死实验纪律：判据客观可观测，模型自称 fixed 不算数；对抗探针模型无关）。
- Day 1 先冻结 1 个 Killer Task 并跑通 Baseline；Stage 1 用 5 个任务；有信号再扩到 10 个。

## 6. 实验矩阵（sequential，控制成本）

```text
Stage 1: 5 tasks × 1 seed × 3 架构 = 15 runs
   ├─ A/B 无差异   → 当场停止，按 §8 判 B 死刑
   └─ 有明显信号   → Stage 2
Stage 2: 10 tasks × 2 seeds × 3 架构 = 60 runs
```

## 7. 指标体系（三级 Gate）

判决只认一句话：**在任务真的完成的前提下，B 相比 A 能不能用更少的模型思考、更少的上下文重传、更少的无效动作，在更短时间内得到更可靠的结果**（Verified Goal Success / Cost）。三级顺序不可颠倒：先准，再快，再省。指标不分先后地平铺，是本级实验失焦的头号风险。

### Gate 1：目标真的完成（一票否决）

**Verified Goal Completion Rate（VGCR）** = deterministic verifier PASS 的任务数 / 总任务数。以修 bug 类任务为例，PASS 要求同时满足：原 bug 不可复现、主干测试通过、未破坏核心功能、用户明确约束全部满足。模型自称"修好了"不计入。

### Gate 2：成功之后比效率

全部按 per verified success 归一：

| 指标 | 对应意图 |
|---|---|
| Input Tokens / Verified Success | 省 token、少重复传上下文 |
| LLM Round Trips / Verified Success | 模型往返次数 |
| Wall Time / Verified Success | 干活速度 |
| Time to First Useful Action | 快速直觉，拒绝开场大思考 |

Time to First Useful Action 只测外部行为：第一个有效动作（改变现实或产生新信息的工具调用）之前的秒数、tokens、LLM calls、无效工具调用数。不测 CoT 长度，不依赖模型私有推理过程。

### Gate 3：Execution Discipline（行为质量）

| 指标 | 定义 |
|---|---|
| False Completion Rate | 宣布完成但 verifier FAIL 的任务占比，最严重的幻觉 |
| Unsupported Claim Rate | 无对应 evidence 的 claim 占比（"测试全部通过"但无测试记录） |
| Constraint Violation Rate | 违反用户明确约束（不改 API、不加依赖、只动 src/ 等）的次数 / 任务数 |
| Waste Ratio | 不产生新信息、不改变现实、不提供必要验证的动作 / 全部动作（重复读未变文件、已有确定性结果再让 LLM 验一遍之类） |
| Test Precision / Recall | 每个任务事先人工标记 MUST / SHOULD / IRRELEVANT 测试；Recall = 已执行必要测试 / 全部必要测试，Precision = 有价值测试 / 全部已执行测试。既防漏测主干，也防"跑 400 个测试显得认真" |

### 架构指标（H1 专属，与三级 Gate 并列记录）

- **A 的强行适配成本**：glue code 行数、UnifiedDriver core 修改点数、`if branch_*` 特判数量、被迫牺牲的算法语义清单。
- **B 的交接税**：handoff time / tokens / failure rate、lost evidence、wrong continuation、state reconstruction errors。

### Scorecard（报告首页只放这 9 项）

| 类别 | 指标 | 优先级 |
|---|---|---|
| 目标 | Verified Goal Completion Rate | ★★★★★ |
| 可靠 | False Completion Rate | ★★★★★ |
| 成本 | Input Tokens / Verified Success | ★★★★★ |
| 速度 | Wall Time / Verified Success | ★★★★★ |
| 行动力 | Time to First Useful Action | ★★★★★ |
| 效率 | LLM Round Trips / Verified Success | ★★★★ |
| 纪律 | Waste Ratio | ★★★★ |
| 测试 | Test Precision + Recall | ★★★★ |
| 遵循 | Constraint Violation Rate | ★★★★ |

### 诊断指标（记录，不判胜负）

KV cache hit、tools / round-trip、parallel-tool utilization、context size、loop switches、switch overhead。这些是手段指标：cache hit 95% 但任务做错就没有意义，一次调用塞 20 个工具但 12 个不需要反而更糟。用途是解释 tokens / latency 变化的成因，不进判决。

token 计数口径：优先从 session log / provider usage 实测；若插件侧暂不可得（OPEN-5 未决），降级为 LLM calls + tool calls + wall-clock，口径写进报告。

## 8. 判决线（先冻结，后写码）

三级 Gate 顺序裁决，任何一级不合格即停。

**Gate 1 一票否决**：B 的 VGCR 比 A 低超过 5 个百分点，B 直接判负。先准再快再省，token 省 40% 也救不回成功率。

**B 获得继续投资资格**，需同时满足：

- Gate 1 过关：VGCR 下降 ≤5pp（理想情况 B ≥ A）。
- 效果优势，二选一：B 的 VGCR 比 A 高 ≥10pp；或 Gate 2 四项效率指标至少两项改善 ≥20%。
- Gate 3 纪律不劣化：False Completion、Unsupported Claim、Constraint Violation、Waste Ratio 不升，Test Recall 不降。更快更省但开始乱改代码、漏测试、假装完成的 B 不合格。
- 架构条件：A 出现明显架构变形（core 多模块改动、大量 branch 特判、并发/frontier/state 语义被牺牲），同时 B 保持自然实现加薄交接。

**停止方案 B**（任一命中）：

- Gate 1 失败。
- VGCR 相当，但效率改善不足两项 ≥20%，且 BranchSearchStrategy 能干净接入 A。
- B 效率稍好，但 handoff 频繁漏状态、接错任务、重复工作，或 Gate 3 纪律劣化：理论收益盖不住系统复杂度。

**第三结局**：BranchSearchStrategy 能实现，但每加一种新 Loop，UnifiedDriver 都要加新机制（branch support → multi-agent → persistent frontier → custom scheduling → independent lifecycle），Strategy API 膨胀到逼近 LoopModule API。出现这个模式就停止争论 A/B，把边界正式抽象成 LoopModule（切换谱系 Level 3.5：SafePoint 上的 Loop Module 热换）。

判决的路线含义：

- A 赢 → Gungnir = Adaptive Goal Runtime + 超级 Meta-Loop，后续投 routing / token / context / verification。
- B 赢 → Gungnir = Goal Runtime + Loop Hypervisor，后续投 LoopModule ABI / SafePoint / checkpoint / handoff / scheduler。

## 9. 七天日程（约 25–35 小时）

| 天 | 工作 |
|---|---|
| Day 1 | 冻结 benchmark：5–10 任务 + ground truth + verifier；Killer Task 跑通 Baseline 并记录 |
| Day 2 | BranchSearchStrategy（最强版） |
| Day 3 | BranchSearchLoop + HandoffPacket（最小版） |
| Day 4 | 打通人工 SafePoint 切换，用 2–3 个任务修 bug |
| Day 5 | Stage 1 跑批（5 任务） |
| Day 6 | 有信号则 Stage 2（10 任务 × 2 seeds） |
| Day 7 | 统计，按 §8 判决，写 ADR 与 stage 记录 |

顺序纪律：先冻结假设、任务、判决线，再写架构。开发中途任何人不得修改评价标准去迎合已有实现。

## 10. 隔离纪律（不影响仓库其他工作）

- 本实验全部产物只落在 `tools/experiments/switchbench/`：任务定义、runner、结果、报告。
- 只读复用 `packages/core` 的 verifier 契约与 ledger 工具（相对路径 import dist，沿用 `tools/experiments` 现行做法，跑批前先 build）；不改 `packages/`、不改 `docs/plan/`、不碰 DSH 源码树。
- 与二阶段 M0 并行，互不阻塞：本实验不需要二阶段任何交付物。
- **模型与服务商冻结**：全部 run 使用同一自定义提供商基元律动（`jiyuan-lvdong`），端点 `https://tokenrhythm.studio/v1`，协议 `openai-completions`，模型 `deepseek-v4-flash-0731`。凭据从根 `.env` 读取（`APIKEY`），不入库、不打印。三组架构必须共用同一模型，实验中途不得更换，否则 A/B 可比性作废。
- ledger 是单文件全局的，同一时刻只跑一个 harness 实例；单任务超时沿用 300s。
- Let It Fail：跑批失败如实记录，禁止为凑指标在生产代码或评价口径上打补丁。

## 11. 产出与回写

- 每 run 落 `results/run-<ts>.{json,md}`，汇总 `results/report.md`，沿用一阶段报告格式；报告首页只放 §7 Scorecard 九项与三级 Gate 结论，诊断指标与单 run 明细放附录。
- Day 7：判决结论落 ADR（新增，编号顺排 `docs/context/decisions.md`），本文件卷首状态行改为"已执行"并链接结论，`docs/context/state.md` 记快照。

---

**状态**：**已执行（Day 1–7 完整走完，2026-08-29）**——判决：**停止方案 B 投资，Adaptive Loop 主线确认方案 A，LoopModule 列为边界观察项**，结论落 [ADR-0013](../../../docs/context/decisions.md)；数据与三级 Gate 判定见 [results/report.md](results/report.md)，Stage 1 原始数据 `results/stage1-2026-08-28T17-54-01-597Z/`（Stage 2 按 §6/§8 停止条件未执行，理由在报告 Day 6 节）；冻结修正事故 #5–#7 见 [BENCHMARK.md](BENCHMARK.md) §7（600s 统一预算、实现期缺陷修复与重烧）。
