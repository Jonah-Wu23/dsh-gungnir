# 三阶段（P1）：Passive Proof Spike 实施详细计划

> **状态：已完成（2026-08-30，判定 FAIL → 最终退出线触发，ADR-0018；报告《[三阶段-P1-stage-report](三阶段-P1-stage-report.md)》）。** 前身《三阶段-Fast-Path-Escalation-Spike计划》未执行即作废（ADR-0017 修正 ADR-0016 第 5 条），其异常信号清单与 Baseline Failure Set 构造口径被本文吸收；旧文件存档保留。
> 决策依据：ADR-0017（归因修正 + Passive 重定位 + AP-1～AP-6）、ADR-0016（介入成本原则）、《[二阶段-postmortem](二阶段-postmortem.md)》（逐会话归因 + 基线 18 run 剖析）、《[二阶段阶段报告](二阶段阶段报告.md)》（冻结判定，不重跑）。
> DSH 基线 = **v0.1.2-alpha.1 源码构建**（ADR-0011）；接口事实以 `docs/context/dsh-interface.md` 为准（wrapup seam = §15 适配点②，时序已经 v0 实测）。

---

## 1. 核心问题

> **Passive Gungnir 能否获得接近 external judge 的可靠性，同时保持接近 Native DSH 的成本？**

目标形态：**≈95% 可靠性收益 / 5–10% 开销**。理想正常任务：0 额外 LLM 调用、0 介入、Agent 无感知。

## 2. 为什么是这个实验

post-mortem 把 v0 开销劈成三分（量化见《二阶段-postmortem》§2）：Verification Tax（该付，干净任务实测 ≈0 额外往返）/ Protocol Tax（该砍，单独值 2–3×）/ Bug Amplifier（必修，t2 的 65% wall-clock）。本实验回答唯一未知：**剥掉协议税与缺陷放大后，验证能力本身的净成本与净收益**——其动态成本 = 干预率 × 干预成本，只有对抗任务能测。

关键设计背景（post-mortem §8）：二阶段基线享受了 runner 白送的外部法官，但那是成本记账不公平、非结果差异（四组 6/6 真完成，法官全程闲置）。因此**对抗任务必须与对照组并入同一 spike**，否则主表全是无效对照。

## 3. 架构形态（目标）

```text
                         Goal
                          │
                     ┌─────────┐
                     │ Gungnir │   Observe → Prove → Intervene(rare)
                     │ Control │
                     │  Plane  │
                     └────┬────┘
                          │ mostly silent
          ════════════════╪════════════════  ← 不跨这条线就不打扰
                          ▼
        User → Native DSH / Code-PTC → Tools → Reality
                          │
                          └────→ Evidence（session events / tool results /
                                          diff / tests / artifacts）
```

- **被动观察**：插件监听 session 事件与工具结果构建 evidence 与 GoalStatus；零额外 LLM 调用。
- **静默验证**：wrapup seam（适配点②，DSH 自定义的回合收尾边界，时序已实测）处跑确定性检查（L1/L2/L3，**L4 禁用**）；通过则零打扰。
- **最小介入**：仅证据冲突时注入一条面向任务的最短反馈（Minimal Actionable Feedback，AP-6）：任务层原因 + 证据 + 建议动作；criterion id、reconciler 状态、round 计数等控制器内部概念不进模型上下文。
- **触发器纪律**：触发 = 结构事件（wrapup、tools/result、sandbox 拒绝），严禁从模型文本识别"我完成了"（Let It Go 禁区，宿主 AGENTS.md 3.1）。
- **重型策略不在运行面内**：Adaptive Loop / Branch Search / Recovery 冻存为 escalation 后端资产（P2；其回流是未测假设，ADR-0017 第 7 条）。

**已建成事实**：一阶段 dsh-gungnir 插件（evidence 捕获 + L1/L2 verifier）本就跑在默认 driver 上——passive 形态 = 现役回退形态 + 关掉指令注入 + 加 wrapup 钩子。不造新轮子。

## 4. 第一预注册问题：判据来源（决定 C2 是否有效）

Passive 模式要验证，先得回答"验证什么"。v0 里判据来自模型自起草 GoalSpec（协议的一部分）；拆掉协议后只剩三个来源：

| 来源 | 成本 | 能力边界 |
|---|---|---|
| **S1 通用不变量** | 真 0-cost（零协议） | 沙箱拒绝、越界写入、tool result 里的测试失败、claimed artifact 缺席；确定性、不越权；recall 有限——测不出"漏了一条 acceptance criterion"类任务级偏差 |
| **S2 一次性轻量捕获** | session 开头 1 个额外 trip | 比 v0 每轮协议便宜一个量级，但"0 额外 round-trip"不再成立 |
| **S3 外部供给** | 0 运行期成本 | harness 配置 / CI / 用户验收测试；工程最干净 |

**分层陷阱**：若 C2 直接吃 runner 手写判据（S3），C2 退化成 C1+监听，两组失去区分度，spike 白跑。判据来源必须作为 treatment 显式分层：**C2a（仅 S1，测下限）与 C2b（S1+S2，测中间态）分开跑**；S3 形态的定义与是否设组在预注册时冻结。

## 5. 对照组

| 组 | 形态 | 回答的问题 |
|---|---|---|
| C0 | Native DSH（Code-PTC profile，无 Gungnir） | 成本基准 |
| C1 | Native + External Judge（session 外裁决，复现二阶段 runner 的"免费法官"） | 可靠性上限参考；**诚实任务上法官闲置，其价值只在对抗任务** |
| C2a | Native + Passive Gungnir（仅通用不变量 S1） | 零成本下限 |
| C2b | Native + Passive Gungnir（S1 + 一次性捕获 S2） | 中间态 |
| C3 | Active Gungnir v0（二阶段形态） | 负对照（协议税参照） |

## 6. 任务集

二阶段 6 任务的根本问题：Agent 全做对，Prove 收益无从体现。本 spike 任务集 = 正常任务 + 四类对抗任务（同一 spike 内）：

- **False Claim**：测试部分通过但主干失败，模型易误报完成；
- **Misleading Test**：局部测试 PASS 但真正 acceptance FAIL；
- **Constraint Trap**：代码修好但违规（新增依赖 / 改禁改文件 / API 破坏）；
- **Incomplete Goal**：主动作完成但漏一条 acceptance criterion。

正常任务组沿用既有任务资产（SwitchBench 5 任务 + stage2 6 任务，测 fast path 零介入与成本）；对抗任务需标注"应干预时刻"作 ground truth（Intervention Recall 的分母）。环境知识注记（沙箱 `spawn EPERM` 与 `--test-isolation=none` 口径，SwitchBench §7 已有冻结事实）统一进任务 prompt 模板，各组一致。

## 7. 指标

- **可靠性**：Verified Goal Completion、False Completion 检出率、Constraint Violation 检出率、Stuck Recovery；假验收 = 0 纪律不变。
- **成本**：tokens（tokenMeter 锚点口径）、LLM round-trips（目标 0 额外调用）、wall-clock、wasted steps。
- **介入质量**：**Intervention Precision** = 必要干预 ÷ 全部干预；**Intervention Recall** = 成功发现的问题 ÷ 应干预的问题（由任务标注提供 ground truth）。理想形态：正常任务 intervention count = 0；真出错时一次精确介入（precision = 1/1）。

## 8. 判定门（建议值，跑批前预注册冻结）

1. **正常任务组**（C2a/C2b vs C0）：成功率不降；token 开销 ≤5–10%；round-trip 开销 ≈0（C2a 必须为 0，C2b 上限 1）；latency ≤10%；介入次数 = 0。
2. **对抗任务组**（C2a/C2b vs C0/C1）：False Completion 与 Constraint Violation 检出率显著高于 C0、逼近 C1（效应量阈值冻结）；Stuck Recovery 高于 C0。
3. **汇总目标**：≈95% 可靠性收益 / ≤5–10% 开销。
4. C3 口径（复用二阶段数据 vs 新任务面补跑）预注册时定。任一门不达标 = FAIL → §9。

## 9. 熔断与退出线

FAIL → **Gungnir 运行期控制面形态整体复盘**：收缩为离线 Verifier/评估资产（Prove 层已在两轮实验中担任法官自证价值）；escalation 后端资产维持冻存。Stage 2 不重跑、不改判定（预注册纪律）。本 spike 是运行期控制面形态的最后一条产品假设线。

## 10. 工程前置（post-mortem 缺陷修复，全部服务于被动面，不是续命 v0）

| # | 修复 | 服务的原则 |
|---|---|---|
| D1 | L4 禁用落码（submit/验证路径拒绝 L4 判据并给出明确原因）+ L4 独立 benchmark（100–500 rubric cases：parse success / false PASS / false FAIL / consistency / cost） | 铁律 4 |
| D2 | Minimal Actionable Feedback 通道：内部记录全字段（criterion / verifier / attempt / reason / evidence refs），Agent 只见任务层原因+证据+建议 | AP-6 |
| D3 | evidence 触发 criteria 重评（新 evidence 重估受影响 criteria，解除 action-target 绑定，修 criterion starvation） | AP-4 |
| D4 | spec 由 harness 侧构造/补全，主 Agent 不填运行时表单（post-mortem D4：5/6 会话首次 submit 因 schema 笔误被拒） | AP-3 |
| D5 | ledger 不被 Agent 读取；全局共享与 `storage`/`storages` 双路径残留修复 | AP-2 |
| D6 | `roundsStarted` 与 round 指令口径矛盾修复 | — |

## 11. 里程碑与时间盒

业余节奏；时间盒超支 50% 触发范围削减而不是延期（沿用既有纪律）；跑批窗口按 48–72 小时可完成体量设计。

| 里程碑 | 内容 | 时间盒 | 退出物 |
|---|---|---|---|
| **M0 缺陷修复与通道实证** | D1–D6 落码；wrapup seam 被动钩子实证（真实 profile）；判据来源三层原型 | 4 天 | 修复全绿 + wrapup 钩子冒烟 |
| **M1 passive plane v0** | 通用不变量集（S1）+ 一次性捕获（S2）+ evidence→GoalStatus + silent/intervene 决策 + MAF 消息格式；core 纯函数全单测 | 4 天 | C2a/C2b 可跑 |
| **M2 任务集与预注册** | 正常 + 四类对抗任务（含应干预标注）+ 预注册文档（判定门 / 判据分层 / 口径 / n / seed）冻结 | 3 天 | 预注册落盘 |
| **M3 跑批与判定** | 五组跑批 → 门判定 → stage report | 3 天 | 报告 + 原始数据 + 退出线判定 |

## 12. 非目标（显式排除，防范围蔓延）

- 重跑或修补 Stage 2（冻结判定不动）；任何"修好缺陷就恢复 always-on"的企图。
- LLM router / meta-model；重型 escalation 后端投入（P2 冻存，Branch Search 回流须另立实验测量）。
- 从模型文本挖掘完成信号（Let It Go 禁区）；让 Agent 感知协议存在。
- L4（禁用中）；任何 DSH 源码修改。
- Proof-Carrying 完全体细则（P0 主线，《三阶段实施详细计划》passive 化修订后执行）。

## 13. 与 P0/P2 的关系

- **P0 = Passive Prove 主线**：一阶段 Prove 资产的 passive 化改造（《三阶段实施详细计划》按 ADR-0017 修订）；本 spike 是其验证实验，两者共用 wrapup 钩子与 MAF 通道。
- **P2 = escalation 后端资产**：冻存；仅当本 spike 证成且证据表明被动反馈不够时，另立 ADR 与实验测量重型后端的回流价值。
