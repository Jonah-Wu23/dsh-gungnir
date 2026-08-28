# 术语表（L1）

> 新概念先在这里定义再使用。Gungnir 域在前，DSH 域在后（DSH 部分源自上游文档与实测勘察）。

## Gungnir 域

| 术语 | 定义 |
|---|---|
| **GoalSpec** | 版本化的目标契约：objective、successCriteria、constraints、nonGoals、assumptions、budget。长期真理，只有显式新版本才变。 |
| **GoalStatus** | 期望状态与观测状态的差距刻画：phase、satisfiedCriteria、progressSnapshot、blocker。 |
| **Reconciliation** | 核心循环：observe → plan（rolling horizon）→ commit 一个 action → execute → collect evidence → verify → update status → 重复。源自 Kubernetes controller 的 spec/status 模式。 |
| **Plan Projection** | 计划只是从 GoalSpec+GoalStatus 投影出的临时建议，每轮可重生成，不具长期权威（与 Contract VM 的根本区别）。 |
| **Committed Action** | 一轮内唯一被承诺执行的动作（一阶段粒度：一个 goal round 一个 action）。 |
| **Evidence** | harness 观测到的事实：tool result、exit code、文件状态、外部环境采样。带 locator 可回查。 |
| **Claim** | 模型的自我报告。永远是主张，不是证据；只作 hint。 |
| **Verifier（L1–L5 阶梯）** | L1 deterministic（exit code/测试/JSON predicate/hash）→ L2 artifact（文件/diff/schema/产物）→ L3 external-state（重查网页/API/DB）→ L4 semantic（LLM rubric，低可信）→ L5 human（交回用户）。原则：能用低级绝不用高级。 |
| **Verdict** | Verifier 对一条 criterion 的裁决：PASS / FAIL / PARTIAL / INCONCLUSIVE / STALE / NEEDS_HUMAN。 |
| **假验收** | 形式上验证通过但目标实际失败（如"文章>5000字"≠"高质量分析"）。Gungnir 的头号敌人，GOAL_REVALIDATION 与阶梯原则都是防它。 |
| **GOAL_REVALIDATION** | COMPLETE 前从头重验全部 acceptance criteria/constraints/invariants。软件语境=回归测试；通用语境=结论与证据交叉验证。 |
| **Proof-Carrying Goal Execution** | 全链路留证：GoalSpec → StepContract → Execution → Claim+Evidence[] → Verifier[] → Decision → Status transition。项目的护城河。 |
| **Reconciler 状态机** | SPEC_COMMITTED / EXECUTING / VERIFYING / REVALIDATING / COMPLETE / BLOCKED / NEEDS_HUMAN；转换守卫是纯函数决策表。 |
| **LoopPolicyVector** | （三阶段）策略向量：cognition / orchestration / continuation / verification / context / model / action 七轴。Mode 是策略组合的涌现状态，不是一级实体。 |
| **Transition Guard** | （三阶段）转换裁决器：模型 propose，Harness 依 evidence authorize；带 hysteresis（dwell/cooldown/threshold）防振荡。 |
| **熔断** | 预先声明的放弃条件。触发即停、复盘、降级；不是建议，是命令。 |

## DSH 域

| 术语 | 定义 |
|---|---|
| **DSH** | DeepSeek Harness（`@deepseek-ai/dsh`）。Session → Turn → Step → Model → Tool 生命周期的 agent 框架，一切新行为做成插件。 |
| **Profile** | `$DSH_HOME/profiles/<name>` 下的插件组合：`dsh.profile`（bundles 清单）+ `package.json`（树外插件）+ `cordis.patch.yml`（用户覆盖层）。 |
| **Bundle / Patch 层** | 配置以空根为起点按序叠加：bundles → profile patch → home patch → `--patch`。patch 替换整行 config，无深合并。 |
| **Cordis 插件** | DSH 插件形态：ESM、`apply(ctx)`、显式 inject 声明、Schema 配置；服务与事件挂 `ctx` 上。 |
| **Session Log** | 唯一持久权威。durable 事件 append-only 写入；resume/fork/replay 全靠它。模型可见的状态必须能从中重构。 |
| **Turn / Step** | Turn=一次用户输入到回复的完整周期；Step=Turn 内一次模型请求+工具执行。 |
| **Goal Round** | armed goal 在 agent idle 时由 goal-round-driver 排入的自动续轮；只推进 roundsStarted 于被承认的 goal-sourced user message。 |
| **Activation（armed）** | goal 的续轮授权，进程本地、绝不持久化；resume/fork 后需重新 arm。 |
| **GoalRef / CAS** | `{id, revision}` 比较交换栅栏；过期 revision 的变更被拒。 |
| **Inbox** | agent 的持久待办投影；消息经 durable inbox 插入并 claim。 |
| **Waterfall / Emit 事件** | waterfall：监听器串行，`next()` 传值可改写（如 `agent/pre-step`、`tools/pre-execute`）；emit：广播通知（如 `tools/result`、`goal/changed`）。 |
| **Strict Replay** | 从事件流重建状态时，畸形/断序/非法转换立即报错停在坏事件，不猜测修复。goal 域即此文化。 |
| **Compaction** | 上下文压力下的历史压缩机制；与 ledger 的交互是一阶段 OPEN 风险。 |
| **Spill** | 超大工具结果的落盘策略：log 里存 preview+locator，不存全文。Gungnir evidence 沿用此思路。 |
| **Subagent / Workflow / Ralph** | DSH 的委派三件套：`ctx.subagents`（命名 provider 委派）、`ctx.workflowEngine`（模型写编排脚本）、ralph（固定 fresh-agent 循环，普通插件实现的 specialized orchestration policy——Gungnir 的定位参照物）。 |
| **Headless profile** | `dsh --profile headless "job"`：单会话跑完打印结果退出，集成测试与冒烟的主力。 |
| **树外插件** | 经 `dsh plugin --profile <name> add <pkg>`（转发 pnpm）装进 profile node_modules 的插件，不从 dsh 安装目录解析。 |
