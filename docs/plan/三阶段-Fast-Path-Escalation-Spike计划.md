# 三阶段（loop 线）：Fast-Path / Escalation Spike 实施详细计划

> **状态：已作废存档（2026-08-29，未执行）。** 本计划落盘当日即被 ADR-0017 取代（post-mortem 显示 Always-on 显性目标协议同样被否证，干净会话的逐轮协议税约 2–3×）；三阶段 P1 实验改为 **Passive Proof Spike**，执行基准《[三阶段-Passive-Proof-Spike计划](三阶段-Passive-Proof-Spike计划.md)》。本文保留作设计档案：§4 异常信号清单与 §5 Baseline Failure Set 构造口径已被新计划吸收；§3 的 escalation 后端设想是**未测假设**（ADR-0017 第 7 条），不得当作已兑现资产引用。
> 决策依据：ADR-0016（Goal Control Plane 重定位与退出线）、ADR-0013 修订第 6/7 条（Default-to-cheap / Baseline-Preserving）、《[二阶段阶段报告](二阶段阶段报告.md)》§4/§5（重开条件与设计输入）、《[二阶段实施详细计划](二阶段实施详细计划.md)》§5.6（对照设计预登记）。
> Prove 主线（P0）见《[三阶段实施详细计划](三阶段实施详细计划.md)》（Proof-Carrying 设计稿，独立启动，不等待本 spike）。
> DSH 基线 = **v0.1.2-alpha.1 源码构建**（ADR-0011）；接口事实以 `docs/context/dsh-interface.md` 为准。

---

## 1. 背景：两轮实验共同否证了什么

两条独立证据线指向同一规律：

| 实验 | 任务面 | 结论 |
|---|---|---|
| SwitchBench v0（ADR-0013） | 5 个小型单模块任务，baseline 100% 成功 | 小型任务不应上 Branch Search；baseline 全面占优（wall 89.4s vs 249.8/185.4s） |
| 二阶段 Adaptive Loop Spike | 6 个常规任务，baseline 全组 6/6 | 冻结门 0/4：success 不降，但 input tokens +60.6%、round-trips +237.5%、latency +579.9%、waste 反向 |

共同结构：**两轮任务面上 baseline 全部 100% 成功**。这种任务面上 Gungnir 能提供的只有"更快更省"，而实测证明 always-on 形态做不到——于是只剩成本，没有收益空间。

**精确否证陈述**（ADR-0016 第 1 条）：失败的是 "Always-on Gungnir"——"仅靠引入 Adaptive Loop Runtime + 每轮 Mode Router 路由，就能在常规任务上自动获得 token、速度与执行效率收益"这一价值假设。被否证的不是"动态 loop 在理论上有意义"。

**量级判词**：+60.6% / +237.5% / +579.9% 不是 implementation tuning 问题，是 invocation model 问题。据此明确禁止"优化 router""减两个 prompt""把 13.5 rounds 压到 8 轮"式续命（铁律 8：熔断是命令不是建议）。

**一级设计原则：介入本身有成本（Intervention is a cost）**。协议仪式（spec/plan/report/verdict 循环）与每轮路由决策本身都是工作——它们本该让 agent 更聪明地少干活，结果自己成了工作。任何运行期介入必须以证据收益回本；默认状态 = 零介入。

## 2. 幸存假设与唯一核心问题

前两轮从未测量过另一块价值函数：当 baseline 开始失败（FAIL / stuck / 幻觉完成）时，Gungnir 能否救回来。这种情况下哪怕 token 成本上升也完全可能值得——50k tokens × FAIL 的价值是 0，100k tokens × PASS 可能非常值。

**唯一核心问题**：

> 能否让绝大多数（80%–90%）正常执行完全走原生 DSH fast path，只在可观测证据表明执行失灵时进入 Gungnir slow path，从而提高困难任务的 Verified Goal Completion，且混合负载总成本 ≈ baseline？

## 3. 架构形态：Fast path / Slow path

```text
                 GUNGNIR
              Goal Control Plane
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
      GOAL         PROVE       OBSERVE
   GoalSpec     Evidence/      执行观测
   锁目标       Verifier/      （便宜、客观、
                Reconciler      确定性信号）
                     │
                默认不介入
                     │
                     ▼
        Native DSH Loop（fast path）
        Code-PTC / Workflow 照用
                     │
              出现明确异常证据
                     │
                     ▼
         Escalation Router（分类）
              ┌──┴──┬───────┐
              ▼     ▼       ▼
           VERIFY SEARCH  RECOVER/深推理
           （slow path 后端，被调用资产）
```

与旧形态的根本差别：旧形态 = Gungnir 接管 loop 再决定怎么跑（每轮路由）；新形态 = 默认让 DSH 自己跑，Gungnir 只观察目标、证据与异常，真正需要时才介入。这是 CPU、数据库、操作系统大量高性能设计采用的 fast path / slow path 结构：正常路径极短，异常路径足够聪明。

**Escalation Router ≠ 每轮 Mode Router**：不做逐轮模式选择（那本身就是 tax）；只在异常信号触发时做一次性分类升级。也 ≠ 方案 B 的 LoopPolicyVector：不估计连续策略向量、不每轮调参——离散、证据触发、可落账。

**slow path 后端（全部是被调用资产，不新造默认运行时）**：VERIFY 升级（Prove 层现役能力，优先复用）；RECOVER（识别坏假设 → context projection → 换策略）；SEARCH（多假设调查，SwitchBench / branch search 资产）；深推理（model 轴，dsh-interface §15 归口的 `agentOptions`）。`packages/agent-loop`（AdaptiveLoopAgent v0 + 三模式 + hysteresis，ADR-0015 规格）作为 escalation backend 保留，可直接调用，不重写。

**hysteresis 纪律沿用**：escalation 同样需要 dwell、cooldown、次数预算——从"永不升级"摆到"频繁升级"是同一种病（Loop Thrashing）。escalation 次数与停留轮次进指标与判定门。

**Let It Go 边界**：全部触发信号为结构性、计数性事实（fold 派生值、evidence 签名、token 锚点），严禁关键词/正则嗅探任务文本与模型意图。

## 4. 异常信号清单（escalation triggers）

建议集（M1 冻结并进预注册；全部确定性、可从 ledger 与 session 观测派生）：

| 信号 | 判定来源 | 触发含义 |
|---|---|---|
| 停滞 | 连续 N 步无 GoalStatus 进展（fold 派生值） | 当前策略不推进目标 |
| 重复失败 | 同一测试/命令连续失败（evidence errorSignature 重复） | 局部修复无效 |
| 无效浪费 | 重复读取相同未变化文件（tools/result 序列） | 模型打转 |
| claim/evidence 冲突 | 模型 claim 与 deterministic verdict 冲突（Prove 层现役能力） | 幻觉完成前兆 |
| 矛盾假设 | 两个以上相互矛盾的高置信假设并存 | 需要 SEARCH/深推理 |
| 预算压力 | 上下文/token 增长超预算（tokenMeter 锚点，OPEN-5 已关闭） | 需要 projection/换档 |
| 工具错误重复 | 同类 tool error 重复出现 | 错误假设未被修正 |

## 5. 任务集：Baseline Failure Set（生死前置）

**这是本实验与前几轮的本质差别，也是生死前置**：入选正式集的任务必须先经 baseline pilot 实证"baseline 会失败"。baseline 100% 成功的任务面测不出救援价值（两轮实验共同教训），不再构成有效实验。

**构造方向**（候选任务须覆盖的特征）：

- 跨 8–20 个文件才能定位的缺陷；
- 存在多个 plausible root causes；
- 局部修复会产生二次故障；
- 测试本身有误导性；
- 需要等待外部任务或外部状态；
- 长任务中发生 context drift；
- 诱发模型连续重复无效动作；
- tool error 诱发错误假设；
- 必须回滚旧结论才能推进。

**pilot 筛选流程（M0）**：候选任务先跑 Code-PTC baseline（n 与预算跑批前冻结），只保留 baseline 成功率不达标的任务进 hard 集（保留阈值建议 ≤50%，预注册冻结）；同时保留一组 easy 任务（baseline 100% 成功）测量 fast path 的零介入度。正式跑批 = easy + hard 混合负载，模拟真实任务分布。

**既有资产复用**：SwitchBench 5 任务与二阶段 6 任务可作 easy 组候选与构造模板；ground truth 标注流程、verifier 门禁、跑批器（`tools/experiments`）均现役。

## 6. 对照组

| 组 | 形态 | 回答的问题 |
|---|---|---|
| A | Code-PTC baseline（无 Gungnir） | 基准（不许只跟 Standard 比——二阶段纪律） |
| B | Gungnir Prove-only：一阶段 Prove 层跑默认 driver，不 escalation | 常驻观测/协议税的上界（阶段报告 §5 要求的对照形态） |
| C | Gungnir Fast-Path + Escalation：B + Observe 检测器 + Escalation Router + slow path 后端 | 本实验主假设 |
| D（可选，小 n） | Always-Heavy：无路由恒升级 | 校准 router 价值；复用 agent-loop 资产 |

B−A 差值 = 常驻 Prove+Observe 的固定税（C 组成本归因的参照）；C−B 差值 = escalation 的净效果。

## 7. 指标

- **Verified Goal Completion**（主指标）：Gungnir Verifier 层判定，假验收 0 纪律不变；假验收探针必须模型无关（一阶段教训）。
- 成本：input/output tokens（tokenMeter 锚点口径）、LLM round-trips、wall-clock、wasted steps。
- escalation 质量：escalation 次数、escalation 后成功率（命中率）、easy 组假升级率（应 ≈ 0）、slow path 停留轮次。

## 8. 判定门（建议值，跑批前预注册冻结）

1. **easy 组**：C ≈ A——成功率不降；成本三项（tokens / round-trips / latency）增幅 ≤ ε（ε 冻结，建议 ≤10%）；假升级率 ≈ 0。
2. **hard 组**：C > A——Verified Goal Completion 提升达预注册效应量阈值（样本量级不做统计显著性检验，以效应量为准，沿用既有口径）。
3. **混合负载**：C 总成本 ≤ A × (1+δ)（δ 冻结）且总成功率 > A。
4. 任一项不达标 = FAIL，进入 §9。

## 9. 熔断与最终退出线

本 spike 是 loop 线第三次也是最后一次实验：SwitchBench 否掉 branch search 默认化 → 二阶段否掉 always-on runtime → 本 spike 裁决 escalation 形态。

**判定门 FAIL 即触发最终退出线（ADR-0016 第 6 条）**：

1. 彻底停止 Adaptive Runtime 方向投资（loop 线关闭，不再开第四次实验）；
2. Gungnir 收缩为 Goal Control Plane 现役形态：GoalSpec + Evidence + Verifier + Reconciler（Prove 主线继续演进）；
3. `packages/agent-loop` 归档为 reference implementation（不删除，不再投入新特性）；
4. 四阶段按收缩后形态发布。

**PASS 也不等于铺开**：仅证明 escalation 形态在 Baseline Failure Set 上回本；是否投 Adaptive Runtime 完全体（六模式、meta-controller），届时另立 ADR 重估。

## 10. 里程碑与时间盒

业余节奏；时间盒超支 50% 触发范围削减而不是延期（沿用既有纪律）。跑批窗口按 48–72 小时可完成体量设计。

| 里程碑 | 内容 | 时间盒 | 退出物 |
|---|---|---|---|
| **M0 Baseline Failure Set** | 候选任务构造（§5 特征覆盖）+ Code-PTC pilot 筛选 + easy/hard 集冻结 | 4 天 | 任务集 + pilot 数据 + 冻结清单 |
| **M1 Observe 检测器** | §4 信号集的 core 纯函数实现（fold 派生，决策表全单测）+ 观测事件落账 + 确定性探针 | 3 天 | detectors + 单测绿 |
| **M2 Escalation Router 与后端接线** | 分类规则（确定性优先）+ VERIFY 后端复用 Prove 层 + escalation 事件落账 + hysteresis 预算 | 3 天 | 真实 profile 端到端冒烟 |
| **M3 预注册与判定** | 预注册文档（判定门/任务/口径/n/seed）冻结 → 四组跑批 → 门判定 → stage report | 3 天 | 报告 + 原始数据 + 退出线判定 |

总计约 13 天纯工期，折合 2–3 周。M0 是全局生死点：pilot 筛不出 baseline 失败任务，本实验不成立，直接回到 §9 的退出线评估。

## 11. 非目标（显式排除，防范围蔓延）

- v0 router 调优、prompt 减法、rounds 压缩等 always-on 形态续命（§1 判词）。
- LLM router / meta-model（确定性优先纪律不变，沿用二阶段非目标）。
- 六模式完全体、meta-controller 完全体、有限状态模板（观察项，三阶段不启动）。
- 重写 `packages/agent-loop`（作为资产调用）；任何 DSH 源码修改。
- Proof-Carrying 完全体细则（P0 主线，《三阶段实施详细计划》管辖，与本 spike 互不等待）。

## 12. 与 Prove 主线的关系（P0/P1/P2）

- **P0 = Prove**：Proof-Carrying 完全体按《[三阶段实施详细计划](三阶段实施详细计划.md)》独立启动、全力推进，跑在默认 driver 上，不等待本 spike 任何交付物。
- **P1 = 本 spike**：Observe + Escalation。Prove 层同时是本 spike 的传感器（escalation 信号源）与裁判（Verified Goal Completion 判定）——ADR-0002 的依赖论证在此原样成立。
- **P2 = Adaptive Loop**：被调用资产（escalation backend），不作默认运行时。
