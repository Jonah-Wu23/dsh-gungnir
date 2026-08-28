# 项目速览（L0）

> 目标读者：任何第一次进入本仓库的会话。60 行内讲清是什么、为什么、现在在哪。

## 是什么

**Gungnir**（dsh-gungnir）是 DeepSeek Harness（DSH）的**自适应目标导引系统**：把"一切皆插件"的理念贯彻到底，做**首个动态调整底层 agent loop 的 DSH 插件**。

Slogan：**Lock the goal. Adapt the loop. Prove the hit.**（言出必行。）

三支柱：GoalSpec 锁住目标（Lock）→ Adaptive Loop Runtime 按任务状态切换执行策略（Adapt）→ Evidence + Verifier 阶梯证明命中（Prove）。核心研究对象是 **Adaptive Cognitive Scheduling**：不同任务阶段需要不同的控制算法，Agent 该有一个"认知调度器"，正如操作系统按任务类型换 scheduling policy。

## 为什么是这个形态

四份思想源文档（`docs/idea/`），方向冲突时以《Agentloop自动调整【重新思考版】》为准；结论已固化为 ADR：

- **替换默认 agent-loop 是合法且该做的**（重新思考版，ADR-0012）：DSH 把 session（append-only 账本）、agent（公共接口）、agent-loop（默认 driver）分三层，官方明示 loop 可从配置替换。禁区只有 rewrite history；replace execution policy 是架构本意。seam-only 控制平面的天花板是"只能影响 loop 的 decision，不能拥有 loop 的 topology"，降级为方案 B 退路。
- **换执行层，不换账本**：启动时一次性替换 driver 为 Adaptive Loop Runtime，运行期只切 Loop Strategy，禁止物理热插拔。append-only ledger 反而成为 Adaptive Loop 的飞行数据记录器。
- **证据层是传感器与裁判**（初步结论，经一阶段验证）：meta-controller 的切换信号来自 Evidence/Verifier 层；loop 对照实验的成败也由它判定。
- 命名走单词品牌派：Gungnir——锁住目标（Lock）、调整飞行姿态（Adapt）、证据证中（Prove）。

## 路线图（四个阶段）

| 阶段 | 代号 | 一句话 |
|---|---|---|
| 一 | Gungnir Core（已完成） | 证据驱动 Reconciler 骨架 + 破坏测试 + 20 任务生死实验（"Prove"支柱的地基） |
| 二 | Adaptive Loop Spike | 替换默认 loop：三模式（FAST/EXECUTE/VERIFY）+ 确定性 router + 四组对照实验，带继续/熔断门 |
| 三 | Adaptive Runtime + Proof-Carrying | 六模式完全体 + meta-controller（hysteresis）+ 五级 Verifier 阶梯 + GoalSpec Compiler |
| 四 | Open Gungnir | 发布、文档、生态 |

## 现在在哪

见 [state.md](state.md)（活文档）。铁律与纪律见仓库根 `AGENTS.md`；架构见 [architecture.md](architecture.md)。
