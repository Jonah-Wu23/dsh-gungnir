# 项目速览（L0）

> 目标读者：任何第一次进入本仓库的会话。60 行内讲清是什么、为什么、现在在哪。

## 是什么

**Gungnir**（dsh-gungnir）是 DeepSeek Harness（DSH）的 **Evidence-Guided Agent Control Plane**：默认让原生 DSH loop 自己跑，Gungnir 被动观测执行（OBSERVE）、用证据静默裁决完成（PROVE），只有证据表明执行失灵才出手（INTERVENE）。产品原则：**能正常干活就别管，悄悄验证，有证据出问题才出手**。替换默认 agent loop 的能力已建成并实证，冻存为 escalation 后端资产（ADR-0012/0014 建成，ADR-0016/0017 重定位）。

Slogan：**Lock the goal. Adapt the loop. Prove the hit.**（言出必行。）

投资优先级（ADR-0017）：P0 = Prove（Evidence + Verifier 阶梯证明命中，现役主力，passive 化改造中）→ P1 = Passive Proof Spike（被动控制面唯一幸存假设的检验）→ P2 = 冻存的重型 escalation 后端（Adaptive Loop / Branch Search / Recovery）。二阶段 post-mortem 把成本拆成三类：Verification Tax（必要，干净任务实测 ≈0 额外往返）、Protocol Tax（该砍，实测 2–3×）、Bug Amplifier（必须修）。核心研究对象仍是 **Adaptive Cognitive Scheduling**，但调度器的主职从"每轮选模式"改为"判断何时不介入"。

## 为什么是这个形态

四份思想源文档（`docs/idea/`），方向冲突时以《Agentloop自动调整【重新思考版】》为准；结论已固化为 ADR：

- **替换默认 agent-loop 是合法且该做的**（重新思考版，ADR-0012）：DSH 把 session（append-only 账本）、agent（公共接口）、agent-loop（默认 driver）分三层，官方明示 loop 可从配置替换。禁区只有 rewrite history；replace execution policy 是架构本意。seam-only 控制平面的天花板是"只能影响 loop 的 decision，不能拥有 loop 的 topology"，降级为方案 B 退路；ADR-0016 起替换能力保留为 escalation 后端资产，不再是默认运行形态。
- **协议税 ≠ 验证税**（ADR-0017，post-mortem 归因修正）：两轮实验否证的是 always-on 协议仪式（二阶段实测 tokens +60.6%、round-trips +237.5%、latency +579.9%）；逐会话剖析证明确定性验证本身在干净任务上 ≈0 额外往返，烧钱大头是 spec/round/report 协议与 L4 死锁放大。公平性口径：基线的"零浪费"含 runner 在 session 外白送的外部裁决——这是成本记账上的不公平，四组 6/6 全真实完成，未产生结果差异。Gungnir 的价值命题 = 把这个法官搬进运行时且几乎免费。
- **换执行层，不换账本**：启动时一次性替换 driver 为 Adaptive Loop Runtime，运行期只切 Loop Strategy，禁止物理热插拔。append-only ledger 反而成为 Adaptive Loop 的飞行数据记录器。
- **证据层是传感器与裁判**（初步结论，经一阶段验证）：meta-controller 的切换信号来自 Evidence/Verifier 层；loop 对照实验的成败也由它判定。
- 命名走单词品牌派：Gungnir——锁住目标（Lock）、调整飞行姿态（Adapt）、证据证中（Prove）。

## 路线图（四个阶段）

| 阶段 | 代号 | 一句话 |
|---|---|---|
| 一 | Gungnir Core（已完成） | 证据驱动 Reconciler 骨架 + 破坏测试 + 20 任务生死实验（"Prove"支柱的地基） |
| 二 | Adaptive Loop Spike（已完成：工程全过、冻结门 FAIL 熔断） | 替换默认 loop：三模式（FAST/EXECUTE/VERIFY）+ 确定性 router + 四组对照实验，带继续/熔断门 |
| 三 | Evidence-Guided Control Plane：Passive Prove + Passive Proof Spike（**已完成：判定 FAIL → 退出线**） | P1 spike 收官：C2a 形态成立（零协议/零介入/成本≈原生），S2 精度受限，检出率不可测；运行期控制面收缩为离线 Verifier/评估资产（ADR-0018） |
| 四 | Open Gungnir | 发布、文档、生态 |

## 现在在哪

**2026-09-01（ADR-0021/0022）**：P2 Escalation Proof Spike 收官——G2/G3/G4 PASS（运行期拦截能力首次证成：③ 2/2 追平离线、①② 规避 E2 4/4 vs E0 1/4），G1 FAIL（1 次 S1 真阳性拦截 + 往返 +1.5）→ BPAR v0 死刑按预注册执行；同日用户三裁决落 ADR-0022——门禁程序修正（门值冻结前须经用户逐项确认）、BPAR v0.1 修复两件（S1 完成调用豁免 + COMPLETION_LINE）、**P3 宽门确认批**（replay 回归零 run + 真跑 ≤3 run，G-FIX 唯一硬门，待执行）；过门 → BPAR v0.1 取得四阶段发布候选资格。执行基准《[三阶段-P3-BPAR-v0.1-确认批计划](../plan/三阶段-P3-BPAR-v0.1-确认批计划.md)》。

**2026-08-31 转向（ADR-0021）**：实验归因纪律升格铁律 10（装置失败 ≠ 假设失败，INVALID 重烧再判不进分母）；证据清算确认 BPAR + Escalation Router 形态从未被实验（程序性替换而非否证）；**BPAR v0**（三方案最近似形态：一次性契约 + 被动面 + 恒等 driver + 例外升级，健康路径预算 ≤ baseline +10%）冻结，三阶段 **P2 = Escalation Proof Spike** 已规划（escalation 形态首次审判），执行基准《[三阶段-P2-Escalation-Proof-Spike计划](../plan/三阶段-P2-Escalation-Proof-Spike计划.md)》。

三阶段 P1 Passive Proof Spike 已收官（2026-08-30）：**判定 FAIL → 最终退出线触发**，Gungnir 收缩为离线 Verifier/评估资产（ADR-0018；其中 C2b 失败项按 ADR-0021 铁律 10 溯及改记 INVALID）。同日 ADR-0019：H-LH（压缩边界判据重注）前提被生产实测驳回，立项 **H-VE（验证器效力注入式基准）**——把实测病理写进夹具考核离线判定栈自身，分母结构性非零，作为四阶段离线资产的质量门；执行基准《[H-VE-验证器效力基准计划](../plan/H-VE-验证器效力基准计划.md)》。见 [state.md](state.md)（活文档）；铁律与纪律见仓库根 `AGENTS.md`；架构见 [architecture.md](architecture.md)。
