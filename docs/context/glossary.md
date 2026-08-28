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
| **Proof-Carrying Goal Execution** | 全链路留证：GoalSpec → StepContract → Execution → Claim+Evidence[] → Verifier[] → Decision → Status transition。"Prove the hit"支柱的护城河。 |
| **Reconciler 状态机** | SPEC_COMMITTED / EXECUTING / VERIFYING / REVALIDATING / COMPLETE / BLOCKED / NEEDS_HUMAN；转换守卫是纯函数决策表。 |
| **Adaptive Loop Runtime** | （ADR-0012，二阶段起）Gungnir 的核心：实现 DSH Agent contract 的稳定 driver，启动时经组合接缝一次性替换默认 agent-loop，session 生命周期内单实例。内部持有 LoopStrategy 集合与 meta-controller。 |
| **Loop Strategy** | Runtime 内可切换的执行策略（认知模式）：REFLEX（能不思考就不思考）/ EXECUTE（runtime 干活：Code Mode、批量与并行工具）/ DELIBERATE（高不确定高代价才调用的深思）/ VERIFY（deterministic → cheap verifier → independent LLM judge 的优先序）/ RECOVER（停滞检测后换假设、换投影、换策略）/ FINALIZE（对照 expected vs actual 的独立收官）。WAIT 是运行状态，不算认知策略。 |
| **Meta-controller / Router** | 依 state + observations + goal + budget + risk 决定下一策略的裁决器。event-driven，简单信号走确定性规则，只有真正模糊的转换才请 meta-model。 |
| **Adaptive Cognitive Scheduling** | 本项目的研究对象：给 Agent 一个认知调度器，按任务状态选控制算法（操作系统按任务类型换 scheduling policy 的同构）。 |
| **Loop Thrashing** | 策略振荡：meta-loop 在模式间来回跳，自己开始烧 token。动态 loop 的头号敌人；hysteresis 五件套防它。 |
| **机制/策略分离** | 机制层稳定（contract、ledger、安全、取消、持久化、可观测），策略层允许激进变化（projection、model、budget、工具执行策略、branching、retry、stop 条件等）。 |
| **Context Projection** | "删除致错上下文"的正确做法：ledger 不动，换模型可见的投影视图（summary / fork boundary），错误事件留在账本里但不再当 authoritative context。 |
| **LoopPolicyVector / Transition Guard** | （原三阶段 seam 方案概念，ADR-0012 后并入 meta-controller 设计）策略向量与转换裁决器；其"propose/authorize + hysteresis"思想由 Adaptive Loop Runtime 继承。seam-only 形态降级为方案 B 退路。 |
| **UnifiedDriver** | （SwitchBench）实验内最小统一 agent-loop 契约宿主：单一主上下文、turn=请求→工具→结果、单响应内工具并行、无上下文删除。代理未来 Adaptive Meta-Loop 的"物理规律"；也是方案 B 的接班 loop（ExecutionLoop 同一份代码）。 |
| **SafePoint** | （SwitchBench，方案 B）可安全更换 Loop 实现的时点：无 open model request / open tool call / pending 状态。SwitchBench 中由实验脚本预先规定（调查完成后），不做自动 router。 |
| **HandoffPacket** | （SwitchBench，方案 B）SafePoint 交接的 8 字段冻结 schema：goal_spec / goal_status / selected_hypothesis / verified_facts / evidence_refs / artifact_refs / unresolved_questions / recommended_next_action。禁止传递 loop 内部状态；Goal 连续性只依赖它 + GoalSpec/GoalStatus/Evidence。 |
| **Branch Search** | （SwitchBench 被测拓扑）多假设并行调查 → 各持独立状态与证据 → 比较收敛 → 进入执行的 loop 拓扑；刻意选择"最难干净 Strategy 化"的形态做 H1 判决。判决结论见 ADR-0013。 |
| **熔断** | 预先声明的放弃条件。触发即停、复盘、降级；不是建议，是命令。 |

## DSH 域

| 术语 | 定义 |
|---|---|
| **DSH** | DeepSeek Harness（`@deepseek-ai/dsh`）。Session → Turn → Step → Model → Tool 生命周期的 agent 框架，一切部件都是插件。 |
| **Profile** | `$DSH_HOME/profiles/<name>` 下的插件组合：`dsh.profile`（bundles 清单）+ `package.json`（树外插件）+ `cordis.patch.yml`（用户覆盖层）。 |
| **Bundle / Patch 层** | 配置以空根为起点按序叠加：bundles → profile patch → home patch → `--patch`。patch 替换整行 config，无深合并。 |
| **Cordis 插件** | DSH 插件形态：ESM、`apply(ctx)`、显式 inject 声明、Schema 配置；服务与事件挂 `ctx` 上。 |
| **Agent Contract / Driver** | `dsh-agent` 定义公共 Agent 接口；`dsh-agent-loop` 是实现该接口的默认 driver（`ctx.agentLoop`）。官方架构明示 agent loop 与其他部件一样可从配置替换（源码树 `docs/architecture.md:11,59`、`docs/capability-seams.md:507`）；Gungnir 的 Adaptive Loop Runtime 就是替换实现。 |
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
| **Code Mode / PTC** | DSH 已有的程序化工具调用：模型生成一段程序，中间工具结果不回灌上下文，只有最终输出回到 conversation。Gungnir EXECUTE 策略直接利用它，不重造。 |
| **Subagent / Workflow / Ralph** | DSH 的委派三件套：`ctx.subagents`（命名 provider 委派）、`ctx.workflowEngine`（模型写编排脚本）、ralph（固定 fresh-agent 循环，普通插件实现的 specialized orchestration policy——Gungnir 的定位参照物）。 |
| **Headless profile** | `dsh --profile headless "job"`：单会话跑完打印结果退出，集成测试与冒烟的主力。 |
| **树外插件** | 经 `dsh plugin --profile <name> add <pkg>`（转发 pnpm）装进 profile node_modules 的插件，不从 dsh 安装目录解析。 |
