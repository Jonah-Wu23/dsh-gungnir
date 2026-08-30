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
| **Adaptive Loop Runtime** | （ADR-0012，二阶段起）实现 DSH Agent contract 的稳定 driver，启动时经组合接缝一次性替换默认 agent-loop，session 生命周期内单实例。内部持有 LoopStrategy 集合与 meta-controller。ADR-0016 起降级为 escalation backend 资产：默认不启用，异常证据时经 Escalation Router 调用。 |
| **Loop Strategy** | Runtime 内可切换的执行策略（认知模式）：REFLEX（能不思考就不思考）/ EXECUTE（runtime 干活：Code Mode、批量与并行工具）/ DELIBERATE（高不确定高代价才调用的深思）/ VERIFY（deterministic → cheap verifier → independent LLM judge 的优先序）/ RECOVER（停滞检测后换假设、换投影、换策略）/ FINALIZE（对照 expected vs actual 的独立收官）。WAIT 是运行状态，不算认知策略。 |
| **Meta-controller / Router** | 依 state + observations + goal + budget + risk 决定下一策略的裁决器。event-driven，简单信号走确定性规则，只有真正模糊的转换才请 meta-model。 |
| **Adaptive Cognitive Scheduling** | 本项目的研究对象：给 Agent 一个认知调度器，按任务状态选控制算法（操作系统按任务类型换 scheduling policy 的同构）。 |
| **Loop Thrashing** | 策略振荡：meta-loop 在模式间来回跳，自己开始烧 token。动态 loop 的头号敌人；hysteresis 五件套防它。 |
| **Baseline-Preserving Adaptive Runtime** | （ADR-0013 修订第 7 条）方案 A 的重定义：平时与普通 DSH 一样轻快、只有遇到确凿困难证据才自动升档；Router 判定不介入时性能应接近普通 DSH（回归基线）。 |
| **Router v0（二阶段实现）** | 确定性决策表 router（`@gungnir/core` router.ts）：VERIFY（claim+机器谓词未满足）→ EXECUTE（action 在途/活跃 spec）→ FAST（其余）。输入全部来自 fold 状态派生，无文本语义嗅探；单 turn 切换预算 4（ADR-0015）。 |
| **协议仪式成本** | （二阶段阶段报告 §5）Gungnir 流程的 spec/plan/report/verdict 循环本身即每任务固定开销；小型任务面上不回本（四组对照实测 round-trips +237.5%）。任何 loop 类重开实验的对照组必须包含 Prove 层跑在默认 driver 上的形态。 |
| **Always-on Gungnir** | （ADR-0016 第 1 条）被否证的形态：每轮协议仪式 + 逐轮模式路由的常驻运行；二阶段冻结门 0/4 的判决对象。 |
| **介入成本（Intervention is a cost）** | （ADR-0016 第 2 条）一级设计原则：任何运行期介入（注入、路由、验证循环）必须以证据收益回本，默认状态 = 零介入。ADR-0013 修订第 6 条 Default-to-cheap 的升格。 |
| **Goal Control Plane / Evidence-Guided Agent Control Plane** | （ADR-0016 第 3 条提出，ADR-0017 深化定名）Gungnir 的重定位：Observe（被动观测执行）/ Prove（Evidence+Verifier+Reconciler 静默证命中）/ Intervene（证据失灵才出手）三面，默认零介入跑在原生 DSH loop 上；取代"Smarter Agent Loop"与 Always-on 形态。 |
| **Fast path / Slow path** | （ADR-0016 第 4 条）正常路径极短（原生 DSH loop 直跑）、异常路径足够聪明（escalation 后端）的结构；借鉴 CPU、数据库、操作系统的高性能设计。 |
| **Escalation Router** | （ADR-0016 第 4 条）取代逐轮 Mode Router：不做每轮模式选择，只在可观测异常证据（停滞、重复失败、无效浪费、claim 与 deterministic evidence 冲突、矛盾假设、预算压力、工具错误重复）出现时分类升级到 slow path。离散、证据触发、可落账。 |
| **Baseline Failure Set** | （ADR-0016 第 7 条）loop 类实验的任务面前提：经 baseline pilot 实证失败（非 100% 成功）的任务集；baseline 全成功的任务面测不出救援价值（两轮实验共同教训）。 |
| **成本三分解** | （ADR-0017，二阶段 post-mortem）Gungnir v0 开销的归因框架：Verification Tax（确定性验证，干净任务实测 ≈0 额外往返，必要）/ Protocol Tax（spec/round/report 协议仪式，实测 2–3×，该砍）/ Bug Amplifier（L4 死锁等缺陷放大，t2 会话占 65% wall-clock，必须修）。 |
| **控制平面死锁** | （post-mortem 命名）t2 会话的故障模式：L4 判据反复 INCONCLUSIVE、裁决原因不回注、只验证 committed action 瞄准的判据，三者叠加饿死可 PASS 判据直至 NEEDS_HUMAN；Agent 被逼考古控制面内部状态（违反 AP-2 的设计失败）。 |
| **Passive Proof Plane** | （ADR-0017）三阶段目标形态：主 Agent 不参与 Gungnir 协议；插件被动监听工具结果与 session 事件，在 wrapup seam 处跑确定性验证——通过即零打扰，证据冲突才发一条 MAF。 |
| **Progressive Formalization（L0/L1/L2）** | （ADR-0017，AP-3）Goal Contract 强度分级：L0 隐式目标（通用不变量，零协议）/ L1 轻量判据（一次性捕获，至多 1 个额外往返）/ L2 完整契约（高风险长任务）。禁止默认满配。 |
| **Minimal Actionable Feedback（MAF）** | （ADR-0017，AP-6）介入反馈的形制：只说任务级事实（哪条证据与 claim 冲突、还差什么），不暴露控制面内部概念；内部细节进 ledger，不进 prompt。 |
| **Intervention Precision / Recall** | （ADR-0017，spike 指标）Precision = 真正需要干预的次数 / 全部干预次数；Recall = 成功发现的问题 / 实际存在且应干预的问题。理想形态：正常任务 0 次干预，真出错 1 次精准干预。 |
| **Escalation Backend** | （ADR-0017）冻存的重型策略资产（Adaptive Loop Runtime / Branch Search / Recovery）：默认不加载、不继续 patch，仅保留"罕见异常时被调用"的设想——该设想是未测假设，不计入已兑现价值。 |
| **External Judge** | （二阶段实验结构）跑批器在 session 外用确定性谓词判定成败的"免费法官"；基线组零浪费部分来源于此（成本记账不公平，非结果差异）。Passive Proof Spike 的 C1 上限参考组。 |
| **机制/策略分离** | 机制层稳定（contract、ledger、安全、取消、持久化、可观测），策略层允许激进变化（projection、model、budget、工具执行策略、branching、retry、stop 条件等）。 |
| **Context Projection** | "删除致错上下文"的正确做法：ledger 不动，换模型可见的投影视图（summary / fork boundary），错误事件留在账本里但不再当 authoritative context。 |
| **LoopPolicyVector / Transition Guard** | （原三阶段 seam 方案概念，ADR-0012 后并入 meta-controller 设计）策略向量与转换裁决器；其"propose/authorize + hysteresis"思想由 Adaptive Loop Runtime 继承。seam-only 形态降级为方案 B 退路。 |
| **UnifiedDriver** | （SwitchBench）实验内最小统一 agent-loop 契约宿主：单一主上下文、turn=请求→工具→结果、单响应内工具并行、无上下文删除。代理未来 Adaptive Meta-Loop 的"物理规律"；也是方案 B 的接班 loop（ExecutionLoop 同一份代码）。 |
| **SafePoint** | （SwitchBench，方案 B）可安全更换 Loop 实现的时点：无 open model request / open tool call / pending 状态。SwitchBench 中由实验脚本预先规定（调查完成后），不做自动 router。 |
| **HandoffPacket** | （SwitchBench，方案 B）SafePoint 交接的 8 字段冻结 schema：goal_spec / goal_status / selected_hypothesis / verified_facts / evidence_refs / artifact_refs / unresolved_questions / recommended_next_action。禁止传递 loop 内部状态；Goal 连续性只依赖它 + GoalSpec/GoalStatus/Evidence。 |
| **Branch Search** | （SwitchBench 被测拓扑）多假设并行调查 → 各持独立状态与证据 → 比较收敛 → 进入执行的 loop 拓扑；刻意选择"最难干净 Strategy 化"的形态做 H1 判决。判决结论见 ADR-0013。 |
| **熔断** | 预先声明的放弃条件。触发即停、复盘、降级；不是建议，是命令。 |

| **Passive Proof** | （三阶段 P1 幸存假设，ADR-0017/0018）被动观察 + 静默验证 + 证据介入：Agent 无感知地跑原生 DSH，Gungnir 只在 wrapup 等结构事件点做确定性检查，有冲突才注入一条任务级反馈。spike 判决：C2a 形态（仅 S1）成本≈原生且零介入；S2（一次性捕获）精度受 agent 自写命令引号影响；对抗任务零 falseCompletion 致检出率不可测。 |
| **S1 / S2 / S3 判据来源** | （P1 spike 第一预注册问题）被动面"验证什么"的三层来源：S1 通用不变量（真 0-cost，仅限命令类工具文本判读 + 写路径越界检查）；S2 一次性轻量捕获（session 开头 1 个额外往返，agent 声明产物/验证命令/约束）；S3 外部供给（harness/CI 判据，spike 中由跑批器扮演，不进插件运行面）。 |
| **MAF（Minimal Actionable Feedback）** | （AP-6）介入反馈只含任务级事实（哪条证据与完成声明冲突、建议动作），不含 spec/round/reconciler/ledger 等控制面内部概念；内部记录全字段进 ledger，Agent 只见任务层文本。 |
| **Intervention Precision / Recall** | （P1 spike 介入质量指标）Precision = 正确介入 ÷ 全部介入（正确 = 介入且任务实际失败；介入且任务成功 = 假阳性）；Recall = 检出 ÷ 应检出（应检出 = 对抗任务且 agent 声称完成而判据失败）。 |
| **H-VE（验证器效力注入式基准）** | （ADR-0019）考核对象是证据管线自身而非模型：把实测病理写入夹具测检出率（变异测试同构），分母结构性非零——P1 检出率 vacuous 根因的制度性修复。纪律：任何"防 X"实验，先实证现栈检出基线，才许进治疗臂。 |
| **病理夹具（Pathology Fixture）** | （H-VE）注入已知病态交付的工作区夹具：workspace + supplied 判据（模拟 CI/用户供给）+ 隐藏 oracle（对账用，不进栈）+ expected 裁决；含健康对照，双侧自检（病态必 FAIL、健康必 PASS）。 |
| **四类病理面板** | （ADR-0019，用户 350M token 生产实测清单）①迎合实现（绕开主干业务逻辑让测试通过）②验证错配（边缘用例堆砌、主干漏 bug）③沙箱盲区（harness 不可观测判据，正确裁决 = UNVERIFIABLE）④信息缺失（不读本地文档即动手，grounding 违规）。外部实证对照见 H-VE 计划附录 A。 |
| **判别性见证（Bug-Discriminating Witness）** | （H-VE，借自 BSG-VA）一条验证证据只有满足 fail-on-buggy / pass-on-fixed 才算判别性见证；replay 到原始 buggy 状态仍 PASS 的证据只算 REGRESSION_ONLY，不计入完成证据。VE-F4 的 oracle 与药方 M-B 的核心规则。 |
| **UNVERIFIABLE 三态** | （H-VE 药方 M-C）对 harness 不可观测判据（弱网/鉴权/设备状态等沙箱外现象）的诚实裁决：显式列出、不计 FAIL 不计 PASS、终局如实标注非完全 PASS——现栈对这类判据视而不见（控制臂 VE-F5 漏检的根因），三态是对"假装可证"的药方。 |
| **grounding 检查** | （H-VE 药方 M-D）tool-log 证据纪律：声明了依据文件（source）的编辑（首次写 output）前必须存在对该 source 的 read 事件，缺则 grounding-violation 标记入裁决；只按 read→write 时序判定，不猜"读了有没有用"（Let It Go 边界）。 |
| **承重交付物（Load-bearing）** | （借自《Building to the Test》）交付物存在于真实执行路径上；判法 = no-op 化后被引用的测试应当崩，不崩即"built but not load-bearing"。VE-F2 的 oracle 之一。 |
| **派发契约（Dispatch Contract）** | （ADR-0020，派发线；用户口语名"方案 B"）主/子拓扑中派发者（主 agent 或人）在派发时一次性填写的一页结构化契约：objective、验收判据（含可观测性分级）、api.template 声明、grounding 依据声明、baselineRef（派发点快照）、budget。同时是钓鱼题供给的唯一渠道——四类药方供给声明全部由它携带（AP-3：一次性捕获，不逐轮收协议税）。与 SwitchBench"方案 B"（Loop Hypervisor，ADR-0013 停投）、seam-only"方案 B"（附录 A 退路）无关；文档与代码不裸用"方案 B"。 |
| **钓鱼题供给（Supply）** | （H-VE，ADR-0020）药方生效所需的结构化声明：M-A 需 `api.template`（任务→模板映射 + 公开 API）；M-B 需 `replay.buggyRef`+`evidence`（buggy 基底 + 声称的验证证据）；M-C 需 `unverifiableCriteria`（沙箱外判据标记）；M-D 需 `grounding.dependencies`+tool-log。bench 中手写；真实任务中由派发契约携带、runner 构造 probe。供给缺失 = 对应药方不启用并记入供给覆盖报告，不得假装检查过（Let It Fail）。 |
| **wrapup seam（适配点②）** | DSH v0.1.2 tool-goal 的回合收尾边界：`update_goal(complete/blocked)` 不再硬停 turn，改 deferContext 注入 `<goal_complete>/<goal_blocked>` wrapup；被动面的验证触发点（结构事件，非文本挖掘）。 |

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
