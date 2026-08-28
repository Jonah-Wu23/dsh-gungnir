# 项目速览（L0）

> 目标读者：任何第一次进入本仓库的会话。60 行内讲清是什么、为什么、现在在哪。

## 是什么

**Gungnir**（dsh-gungnir）是 DeepSeek Harness（DSH）的树外插件家族，一句话定义：

> a durable, evidence-driven goal reconciliation runtime that continuously drives observed reality toward a versioned human intent.

（持续把观测到的现实推向版本化人类意图的、持久化且证据驱动的目标协调运行时。）

Tagline：**Declare it. Gungnir never misses.**（言出必中。）

原生 `/goal` 解决"我要一直做这件事"；Gungnir 解决"**你凭什么证明，你一直做的事情正在把现实推向我真正要的目标？**"——核心资产是 Proof-Carrying Goal Execution：GoalSpec（版本化目标契约）→ 执行 → Evidence（harness 观测证据）→ Verifier（五级阶梯裁决）→ Reconcile（协调下一动作）。

## 为什么是这个形态

三份思想源文档（`docs/idea/`）推演的结论，已固化为 ADR：

- 不做"会自动切换的 Agent Loop"，做它之上的**控制平面**；Loop Mode 不是一级实体，策略向量才是（Agentloop 文档）。
- UltraGoal 不做超级规划器（Contract VM），做 **Reconciler**：计划只是 rolling-horizon 投影，每轮重新观察、只 commit 一个动作（UltraGoal 文档）。
- **先 Reconciler 后 Loop**：依赖单向——Loop 层的全部切换信号（progress/error/verification debt）来自证据层；两个项目共用生死假设"能否证据驱动地判定开放世界任务的进展"，先打这一仗（初步结论）。
- 命名走单词品牌派：Gungnir——投出=GoalSpec，飞行=Adaptive Loop，命中=Verifier。

## 路线图（四个阶段）

| 阶段 | 代号 | 一句话 |
|---|---|---|
| 一 | Gungnir Core | 证据驱动 Reconciler 最小骨架 + 破坏测试 + 20 任务生死实验 |
| 二 | Proof-Carrying | 五级 Verifier 阶梯、GoalSpec Compiler、replanning、GOAL_REVALIDATION |
| 三 | Gungnir Steering | 自适应 Loop 控制平面（LoopPolicyVector + Transition Guard + propose/authorize） |
| 四 | Open Gungnir | 发布、文档、生态 |

## 现在在哪

见 [state.md](state.md)（活文档）。铁律与纪律见仓库根 `AGENTS.md`；架构见 [architecture.md](architecture.md)。
