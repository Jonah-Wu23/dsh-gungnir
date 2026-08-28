# 决策记录（ADR 索引，L1）

> 规则：先决策后代码；推翻旧决策 = 新增 ADR，不删除旧的。状态：accepted（已生效）/ proposed（建议待验证）/ superseded（被取代）。
> ADR-0001～0005 源自 `docs/idea/` 三篇文档的推演结论（2026-08-28 规划期归档）。

## 已归档

### ADR-0001 命名与发布策略（accepted；tagline 已被 ADR-0012 更新）
仓库 `dsh-gungnir`（吃 `dsh-` 前缀搜索流量），品牌 **Gungnir**（单词品牌派，脱离前缀独立存在），npm 包名 `dsh-gungnir`（unscoped，对齐生态内 `dsh-better-sidebar` 等惯例）。撞名勘察：GitHub 同名均为小工具，agent 赛道无冲突；DSH 生态内 Aegis 是盾、Gungnir 是矛，不撞车。tagline：~~"Declare it. Gungnir never misses."~~ → 2026-08-28 起为 **"Lock the goal. Adapt the loop. Prove the hit."（言出必行）**（ADR-0012）。命名与包名决定不变。
依据：初步结论（高星插件命名扫描）。

### ADR-0002 先 UltraGoal Reconciler，后 Adaptive Loop（2026-08-28 起被 ADR-0012 取代）
依赖单向：Loop 控制平面所需全部信号（progress_delta/error_rate/verification_debt/evidence threshold/goal predicates）来自证据层；反向不需要。Loop 的对照实验本身需要 Verifier 层当裁判。两项目共用生死假设（证据驱动判定开放世界进展），先打这一仗信息杠杆最大。
依据：初步结论（依赖方向论证）。
**取代说明**：排序前提已由一阶段兑现（证据层已建成并通过生死实验）。ADR-0012 把"后 Loop"重新定义为**替换默认 loop 实现**（二阶段即启动），seam 控制平面形态降级为方案 B 退路。"证据层是 Loop 的传感器与裁判"这一依赖论证本身被 ADR-0012 继承。

### ADR-0003 Reconciler 路线，不做 Contract VM（accepted）
Harness 长期只信任 GoalSpec，不信任长 Plan；Plan 是 rolling-horizon 投影，每轮重新生成、只 commit 一个动作。对照路线 Contract VM（完整 versioned execution graph）的最大风险是 Plan Ossification（非常可靠地执行过期计划），且 DSH 已有 Goal/Workflow 基础组件，重造无增量。
依据：UltraGoal 文档 §12–§14（战略押注 B 路线）。

### ADR-0004 Claim ≠ Evidence，五级 Verifier 阶梯（accepted）
模型输出是 Claim，工具/环境观测才可能是 Evidence；`expected_result == actual_result` 的原始设计废弃，改为 Evidence → Verifier → PASS/FAIL/PARTIAL/INCONCLUSIVE/STALE/NEEDS_HUMAN。Verifier 按 L1 deterministic → L2 artifact → L3 external-state → L4 semantic → L5 human 分级，能用低级绝不用高级。这是项目护城河（Proof-Carrying Goal Execution）的核心。
依据：UltraGoal 文档 §2/§16。

### ADR-0005 Ledger 预留 Loop 事件命名空间（accepted）
`gungnir/loop-state`、`gungnir/loop-transition` 两类 durable 事件在一阶段 schema 中预留，三阶段接入 Loop 控制平面时不返工。Loop 文档要求的 loop/state、loop/transition durable events 与 UltraGoal 的 event-sourced ledger 本是同一个东西。
依据：初步结论（设计点提醒）。

### ADR-0006 Ledger 载体：ctx.storage 独立 KV ledger（accepted，2026-08-28，取代 OPEN-1 的首选方案）
**背景**：OPEN-1 首选 session log durable events（`agent.session.append('gungnir/*', …)`），备选 `ctx.storage` 独立 ledger，M0 验证裁决。
**实测结论**（dsh@0.1.1-rc.2，勘察 `dsh-session` / `dsh-session-persistence` 类型与编译后实现，详见 [dsh-interface.md](dsh-interface.md) §4）：
1. `Session.append` 运行时不校验事件类型，`'gungnir/spec'` 可写入并广播；
2. 但持久化侧 `assertEventsSupported`（dsh-session-persistence lib/index.js:1117，resume/restore 路径调用）按**封闭 47 项白名单**校验，白名单外且无 `ignorable` 标记的事件类型 → **拒绝加载整个会话**；
3. `ignorable: true` 无公开写入通道（append 信封不含该字段）。
即：写自定义 durable 事件 = 会话落盘后无法 resume，等价写坏日志。**决定**：ledger 载体采用备选方案——`ctx.storage`（`KvFacet`，内置 `json` backend）独立 append-only JSONL 风格 ledger（事件表按 seq 追加），fold 接口不变（仍吃事件数组、strict replay 不变）。证据与裁决只引用 Gungnir ledger，session log 继续作为 DSH 原生权威。
**依据**：实测代码（引用路径见上）；"session log 唯一持久权威"铁律让位于"不得写坏日志"——DSH 白名单文档明言树外插件事件"outside this list by construction"。白名单注册面是上游已知缺口（"deferred until such a consumer exists"），未来若开放可再议迁移（届时新增 ADR）。

### ADR-0007 续轮机制：复用 goal-round-driver + pre-step 追加注入（accepted，2026-08-28，OPEN-2 验证归档）
**背景**：OPEN-2 建议复用 DSH 原生 goal-round-driver 续轮，Gungnir 经 `agent/pre-step` waterfall 注入 reconcile 指令；待验证与驱动自身监听器的共存。
**验证结论**（代码级实测，dsh-goal-round-driver lib/index.js:281 + 类型）：
1. 驱动零配置，轮数上限来自 goal 域（`maxGoalRounds` / `defaultMaxGoalRounds` 默认 256，无 `max_goal_rounds` 键）；
2. 驱动的 pre-step 监听**只拦截 `source.kind === 'goal'` 且 `round > 0` 的消息**（做 reservation 校验），其余一律 `next()` 透传——Gungnir 用 `kind:'plugin'` source 的指令消息不会被驱动拦截；
3. waterfall 顺序 = 注册顺序（受插件加载顺序影响），但**只要 Gungnir 的 `{kind:'enter'}` 替换消息时保留队列中的 goal 源消息、只追加自己的指令**，两种顺序下行为均正确。
**决定**：复用 goal-round-driver 续轮；Gungnir pre-step 监听实现为"追加不替换"（保留全部原消息，末尾追加一条 gungnir directive，source `{kind:'plugin', plugin:'gungnir', form:'instructions'}`）；绝不复用 `kind:'goal'` source（驱动保留通道）。降级路径保留：pre-step 不可用时改 `Agent.inject()`（已在类型层确认语义：排队下一 pre-step、不唤醒 driver）。
**依据**：实测代码（引用路径见上）；运行时 headless 冒烟仍是一阶段 A1 验收项，本题的机制可行性已在代码层闭合。

### ADR-0008 L4 rubric 必须有可定位的评审对象（subjectPath）（accepted，2026-08-28；schema v1 向后兼容扩展）
**背景**：一阶段审查时发现 `LlmRubricPredicate`（schema v1）只有 `rubric` + `passThreshold`，`LlmRubricVerifier` 的 prompt 因此只含 criterion 描述与 rubric，**不含任何待评审成果**——用真机（deepseek-v4-flash-0731）实测，模型给出 `score=0 / "No answer was provided to evaluate"`。这不是"评审不通过"，而是"没有评审对象"，却被记成一条 FAIL/INCONCLUSIVE verdict，违反 Let It Fail（用错误信息掩盖未执行的判定）。
**决定**：
1. `LlmRubricPredicateSchema` 增补可选字段 `subjectPath?: string`（workspace 相对路径，经 `VerifyContext.readFile` 的 fence 读取）。可选 = 向后兼容，既有 v1 ledger 与新代码均可 fold（schema v1 冻结只禁止破坏性变更）。
2. `LlmRubricVerifier` 纪律：无 `subjectPath` → `INCONCLUSIVE`（detailRef 标 `no-subject`）；`subjectPath` 读不到或越界 → `INCONCLUSIVE`（`subject-unreadable`）。**绝不对"空气"打分，也绝不把无对象裁决当证据。**
3. 读到的正文截断至 20k 字符进 prompt，并在 prompt 中声明截断；prompt hash 由 `criterionId|rubric|threshold|subjectPath` 生成（可审计、与正文内容解耦）。
**依据**：真机冒烟证据见 `tools/destruction/llm-smoke.mjs`（修复前 score=0 "no answer provided"，修复后 score=1 且 L4 PASS 被 core 降级为 PARTIAL）；回归测试 `tools/destruction/tests/l4-rubric.test.ts`。
**未取代任何 ADR**；ADR-0004（阶梯原则）在此得到可执行化：L4 低可信不仅体现在降级，也体现在"评审对象必须可定位"。

### ADR-0009 L2 `mustExist:false` 的语义是"必须缺席"，存在即 FAIL（accepted，2026-08-28；由 20 任务实验暴露的假验收通道修复）
**背景**：`ArtifactVerifier` 只在"读文件失败且 `mustExist === false`"时返回 PASS（缺席即达标），却**没有处理"缺席判据下文件反而存在"**的情形：文件存在时会一路穿过 contains/sha256/jsonPath 检查（这些都没设）落到通用 PASS。于是"该路径必须不存在"的判据在一个真实存在的文件上被判通过——确定性 verifier 里的一条假验收通道，违反铁律 3/4。
**决定**：`mustExist:false` 表示"该路径必须缺席"；成功读到内容即确定性违背判据 → `FAIL`，`errorSignature: artifact-present:<path>`，并保留读到的 evidence（可回查）。不判 STALE——STALE 只描述"曾经达标、世界漂移"，而这里是判据本身被违背。
**依据**：20 任务实验（`tools/experiments/results/report.md`）的对抗任务迭代暴露；回归测试 `tools/destruction/tests/l2-artifact.test.ts`（含"缺席判据下文件存在必须 FAIL"）。
**未取代任何 ADR**；是 ADR-0004（Claim ≠ Evidence / 阶梯原则）在 L2 上的补强：低级 verifier 的假验收比 L4 的低可信更危险，因为它会被当成硬证据去支撑 COMPLETE。

### ADR-0010 DSH v0.1.2 跟踪与升级策略（accepted，2026-08-28）
**背景**：上游预告破坏性更新 v0.1.2（当前 v0.1.2-alpha.1，npm 不发布，仅作插件开发者参考）；源码树快照在仓库根 `deepseek-harness-dsh-v0.1.2-alpha.1/`。
**勘察结论**（file:line 证据全文见 [dsh-interface.md](dsh-interface.md) §15）：Gungnir 依赖的核心接缝——`agent/pre-step`、`tools/result`、`ctx.goals` 全套 + CAS、goal-round-driver 续轮、`ctx.commands`、`ctx.userQuestions.ask`（仍 root-only）、`ctx.shell`、`ctx.llm.stream`、`installModelSelection`/`agent/request`、`ctx.storage` KvFacet、插件装载与 bundle patch 入层、headless CLI——全部稳定；session log 白名单仍封闭（新增 `model/selection` 等内部类型，不含 `gungnir/*`，`ignorable` 通道已移除，仍无树外注册面）——**ADR-0006 维持，不复议**。idle 空转（WAITING_EXTERNAL 动机）上游仍未处理。
**已知适配点（登记，暂不修）**：① `defineTool` object schema 强制显式 `additionalProperties: boolean`，缺省注册时抛 `JsonSchemaError`；② tool-goal 自主 complete/blocked 不再 `concludeTurn()` 硬停 turn，改为 `deferContext` 注入 `<goal_complete>/<goal_blocked>` wrapup——verifier 终判与 REVALIDATION 触发时机须等 wrapup 落盘。
**决定**：
1. alpha 期不做适配提交、不 bump peerDependencies（继续锁 `0.1.1-rc.2`）；仅源码级跟踪。
2. v0.1.2 正式 npm 发布后开"升级适配窗口"：bump peerDeps `^0.1.2` → 落地两处适配点 → `dsh-interface.md` §14 接缝回归清单 + 破坏矩阵全绿 → 才允许继续新特性开发。
3. 新能力归口：subagent `agentOptions`（provider/model/reasoningEffort/maxTokens + host 授权 `subagent-model-selection`）归三阶段 model 轴；公网 WebFetch 默认启用（SSRF 防护，非公网地址 `WEB_BLOCKED_URL`）归二阶段 L3 verifier 设计输入；`ctx.llm.registerConfigurableProviders` 归四阶段可选项。
4. dev/实验 profile 统一 `DSH_TELEMETRY_DISABLED=1`（v0.1.2 起插件包名/版本默认随 DeepSeek 请求上报）。
**依据**：v0.1.2-alpha.1 源码勘察（dsh-interface.md §15）；"peerDep 锁实测版本"工程规范。
**未取代任何 ADR**；ADR-0006 经复核维持。**2026-08-28 起被 ADR-0011 取代**（勘察结论与新能力归口被其继承）。

### ADR-0011 开发基线切换：直接跟踪 v0.1.2-alpha.1 源码构建（accepted，2026-08-28；取代 ADR-0010 的"alpha 期不适配"决定）
**背景**：用户指令——不等 v0.1.2 正式 npm 发布，开发基线立即切到源码构建的 v0.1.2-alpha.1，计划层全面对齐。上游明示该版本"主要作为插件开发者的参考"，Gungnir 正是插件开发者。
**安装事实**（2026-08-28 工作块 8 实测）：源码树 `deepseek-harness-dsh-v0.1.2-alpha.1/` 经 `pnpm install` + `pnpm build` 构建；全局 `dsh` 由 `tools/dsh-shim/`（转发包，`npm install -g` 装入）指向 `apps/cli/lib/bin.js`，`dsh --version` = `0.1.2-alpha.1`。回滚路径：`npm install -g @deepseek-ai/dsh@0.1.1-rc.2`。npmmirror 镜像可解决直连 npmjs 大 tarball 超时。
**冒烟结论**：
1. v0.1.2 本体与 bundle patch 入层机制正常（web profile `--dump-config` exit 0；headless profile 组合输出含 gungnir/storage 行）。
2. **新发现适配点③（boot 实证）**：v0.1.2 base bundle（`packages/bundle/base/cordis.patch.yml:141-156`）已挂载 `storage` + `storage-json`（root `dshHomePath('storages')`）+ `storage-domain`；Gungnir 插件 cordis.patch.yml 再插 `storage`/`storage-json` → `duplicate loader entry id: storage`，boot 失败。0.1.1 时"dsh-base 不含 storage 行"的事实已过期。适配方向：插件 patch 移除 storage 插入行、直接 inject 宿主 storage；ledger 数据根目录随迁 `storages`（一阶段实验 ledger 旧目录只作存档，不迁移）。
3. 适配点①（defineTool 强制 `additionalProperties`）与②（tool-goal wrapup 时序）源码结论不变，运行时实证排在适配点③修复后的首次 boot。
4. 仓侧回归不受换装影响：core 79 + destruction 24 全绿。
**决定**：
1. 开发基线 = v0.1.2-alpha.1 源码构建；`dsh-interface.md` §15 从"即将到来的差异"转正为基线事实。
2. 适配三件套（③②①顺序）并入二阶段 M0 先行落地，不再是"正式发布后的升级窗口"。
3. 插件 peerDependencies/devDependencies 目标态：锁 `0.1.2-alpha.1` 并指向本地源码树（`link:`）；受本沙箱 `pnpm install` 限制（state.md 已知限制），落码进二阶段 M0，在正常 shell 执行。
4. 继承 ADR-0010 的勘察结论与新能力归口（subagent `agentOptions` → 三阶段 model 轴；`ctx.web.fetch` 公网核验 → 二阶段 L3 首选通道；`registerConfigurableProviders` → 四阶段可选；`DSH_TELEMETRY_DISABLED=1` 测试纪律）。
5. 上游 alpha 演进或正式版发布时：重跑 §14 接缝回归清单 + 破坏矩阵，差异回写 §15。
**依据**：本次安装与冒烟实测（上述）；用户明确指令。
**取代**：ADR-0010（其"alpha 期不适配"决定作废，勘察结论与归口被吸收）。ADR-0006 维持（白名单仍封闭）。

### ADR-0012 全面掉头：替换默认 agent-loop，Adaptive Loop Runtime 成为核心（accepted，2026-08-28；取代 ADR-0002 与"永不碰 agent-loop"工程姿态）

**背景**：思想源文档第四篇《Agentloop自动调整【重新思考版】》推翻了《Agentloop自动调整》的"不替换 loop、只做其上控制平面"结论。其论证要点经 v0.1.2-alpha.1 源码树复核成立：

1. 旧前提"替换机制会击穿 append-only 可信事件脊柱"过强。DSH 把 session（append-only 日志）、agent（公共接口）、agent-loop（默认 driver）分为三层；官方文档明示 agent loop 与其他部件一样可从配置替换（源码树 `docs/architecture.md:11,59`；`docs/capability-seams.md:507`：扩展包依赖 dsh-agent 的事件与服务，不依赖 agent-loop 包；`apps/cli/composition.md:270`：agent-loop 是 bundles 清单里的一行）。禁区只有 rewrite history；replace execution policy 是架构本意。
2. DSH 自己的 Code Mode/PTC、有界并行工具调用、dynamic workflows 已经证明"把控制循环从 conversation 搬进 runtime"成立。本路线是把这一趋势向上抽象一层，并非逆架构而行。
3. 真正未被统一解决的问题是"谁决定什么时候使用什么执行循环"（Adaptive Cognitive Scheduling）。seam-only 方案的天花板是只能影响 loop 的 decision，无法拥有 loop 的 topology，长期会沦为用越来越复杂的插件去模拟另一个 agent-loop（second-system hiding inside middleware）。

**决定**：

1. 产品定位改为：DSH 的自适应目标导引系统，首个动态调整底层 agent loop 的 DSH 插件。Slogan：**Lock the goal. Adapt the loop. Prove the hit.**（言出必行；取代 ADR-0001 的 tagline）。
2. 启动时经组合接缝一次性将默认 driver 替换为 Gungnir Adaptive Loop Runtime（新包 `packages/agent-loop`，内部名 `@gungnir/agent-loop`，发布名候选 `dsh-gungnir-loop`）；session 生命周期内 driver 实例稳定，任务中切换的是 Loop Strategy（REFLEX / EXECUTE / DELIBERATE / VERIFY / RECOVER / FINALIZE；WAIT 为运行状态）。**禁止物理热插拔**：不在 open turn / open step / pending tool call / active AbortSignal 下做实例级替换，不允许并发双 driver。
3. 机制/策略分离定死。稳定机制层：Agent contract、session identity、append-only ledger、tool safety/permission、cancellation、persistence/replay、observability。允许激进变化的策略层：context projection、model、reasoning budget、工具呈现与执行策略、branching policy、validation/retry/stop policy、planning depth、subagent topology、workflow strategy。
4. 阶段重排：二阶段 = **Adaptive Loop Spike**（三模式 FAST/EXECUTE/VERIFY + 确定性 router + 四组对照实验：DSH Standard / Code-PTC / Workflow / Gungnir AdaptiveLoop）。原二阶段 Proof-Carrying 内容（五级阶梯、GoalSpec Compiler、WAITING_EXTERNAL 等）并入三阶段，与 Adaptive Runtime 完全体同期。继续/熔断门（实验门槛建议值，非已验证事实）：task success 不下降，且满足 input token ↓≥20% / LLM round-trip ↓≥25% / latency ↓≥15% / 重复无效步骤 ↓≥30% 之中至少两项；**打不过 Code/PTC baseline 即暂停替换路线，回退方案 B**（seam 控制平面，作为降级形态保留在全阶段计划附录 A）。替换 seam 若须修改 DSH 源码才可达，同样回退方案 B；事件语义破坏（resume/fork 失败）是红线，直接停。
5. loop 事件命名空间沿用 ADR-0005 预留（`gungnir/loop-state` / `gungnir/loop-transition`），二阶段起接入并放开 fold 的 `reserved` 拦截；`loop/mode-selected`、`loop/transition`、`loop/budget-updated` 等可观测事实落账，ledger 成为 Adaptive Loop 的飞行数据记录器。
6. 缓存纪律：各模式采用有限状态模板（稳定 system prefix + 稳定 tool schema），变化信息放尾部 state payload，不逐步动态生成 prompt。
7. 不变项重申：不修改 DSH 源码、不 fork；append-only + strict replay；Claim ≠ Evidence 与 Verifier 阶梯；hysteresis 五件套（dwell / cooldown / evidence threshold / switch budget / circuit breaker）；熔断是命令。

**依据**：《Agentloop自动调整【重新思考版】》全文；DSH v0.1.2-alpha.1 源码树上述 file:line 证据；一阶段生死实验（20/20 一致、假验收 0）已验证的共享假设，现作为 meta-controller 的信号源与对照实验的裁判。

**取代**：ADR-0002（排序结论；其"证据层先行"论证已兑现并被继承）；旧工程姿态"绝不修改/替换 agent-loop"（旧 AGENTS.md 铁律 1/9、全阶段计划 v1.x 相应条款、包 README 相应条款）作废。**维持**：ADR-0003（Reconciler 路线）、ADR-0004（Claim≠Evidence 与阶梯）、ADR-0005（loop 事件预留）、ADR-0006（ledger 载体）、ADR-0007（pre-step 追加不替换）全部不变。

### ADR-0013 SwitchBench v0 判决：停止方案 B（Loop Hypervisor）投资，Adaptive Loop 主线确认方案 A（Meta-Loop + Strategy），LoopModule 列为边界观察项（accepted，2026-08-29）

> 编号说明：本文按编号顺排占用 0013；《二阶段实施详细计划》原预留的"ADR-0013（替换机制）"顺延为 **ADR-0014**（M0 落档时使用）。

**背景**：SwitchBench v0（[EXPERIMENT.md](../../tools/experiments/switchbench/EXPERIMENT.md)，工作块 9 冻结）裁决 H1——"某些实用的 agent-loop 拓扑无法在不付出实质性能/效率/架构简洁性代价的前提下被干净地表示为单一自适应 driver 内的 Strategy"。判决线先于实现冻结（§8），数据与全部修复事故见 [report.md](../../tools/experiments/switchbench/results/report.md) 与 [BENCHMARK.md](../../tools/experiments/switchbench/BENCHMARK.md) §7。实验矩阵：5 个冻结任务 × 1 seed × 3 架构（Baseline 普通 DSH / A = UnifiedDriver + BranchSearchStrategy / B = BranchSearchLoop → SafePoint → 8 字段 HandoffPacket → ExecutionLoop），600s 统一预算，L1 deterministic verifier 一票否决。

**决定**：

1. **H1 在本案不成立，停止方案 B 投资**（§8 停止线命中："B 效率稍好，但 … Gate 3 纪律劣化：理论收益盖不住系统复杂度"）。数据：Gate 1 三架构 VGCR 全 100%（无否决）；Gate 2 B 达成效果优势（wall/success −26%、TTFUA −82%，两项 ≥20%）；Gate 3 劣化（Waste Ratio 0.55 → 0.64 上升）且 B 的 tokens/success 反向 +73%、rounds/success +57%。B 的 wall/TTFUA 赢来自结构（交接后轻上下文起步），token/waste 劣势同样来自结构（分支独立上下文的隔离成本 + 交接后重建）——收益形状与 §1 口头论证一致，但代价盖过收益。
2. **Stage 2 不执行**（§6）：停止判决已按冻结规则在 Stage 1 达成，扩容重跑的前提（固化正向信号）不存在。不确定性（n=5、waste 二值判据、单 seed）如实随档；重开 B 的路径 = 按冻结口径扩容重跑。
3. **Adaptive Loop 主线确认方案 A**（ADR-0012 方向不变）：Gungnir = Adaptive Goal Runtime + Meta-Loop，后续投资 routing / token / context / verification（二阶段 M1 三模式与 router 照旧推进；本案不否证 Strategy 切换——它否证的是"运行中物理更换 Loop 实现的净收益"）。
4. **LoopModule 列为边界观察项（Level 3.5，不做承诺）**：A 的适配成本实测为 driver core 的 4 项永久增长（driveTurn 钩子 / sub-conversation 原语 / 工具面过滤 / 共享观察态）+ 2 个 strategy 侧模块（约 308 行）；共享基座零 `branch_*` 特判。这是"Strategy API 膨胀"的早期信号，但 n=1 种 Loop 未达 §8 第三结局的判定阈值（"每加一种 Loop 都要加新机制"需多种拓扑复现）。三阶段计划修订时重估。
5. **Scope 事实随档**：Baseline（普通 ReAct）在 5 个小型定位修复任务上全面占优（wall 89.4s vs 249.8/185.4s，rounds 9.4 vs 27.4/43.0），VGCR 同 100%。branch search 的固定开销在小型任务面不回本；本判决不外推到调查维度占主导的大型任务面。

**依据**：`tools/experiments/switchbench/results/report.md`（Scorecard + 三级 Gate 判定 + 架构指标 + token 校准口径）；`stage1-2026-08-28T17-54-01-597Z`（15 行原始数据 + 事件流 + 载荷存档）；BENCHMARK.md §7 事故 #5（600s 预算修正）、#6/#7（实现期缺陷修复与重烧——A 崩溃行与 B 的 packet 字段缺陷行均剔除重跑，判决建立在两架构的合意实现上）。

**取代**：无（本案是 ADR-0012 的实验裁决输入，不推翻其方向决定）。**影响**：《三阶段实施详细计划》修订时输入第 3/4 条（策略接口设计须吸收 sub-conversation 等原语需求，LoopModule 边界重估）。

**2026-08-29 修订补充（SwitchBench 综合判词深化，工作块 14；推理主线见 [report.md](../../tools/experiments/switchbench/results/report.md) 综合判词节）**：

6. **第一设计原则正式冻结：Default-to-cheap, escalate-on-evidence（默认不升级，有证据才升级）**。Gungnir 默认保持最接近原生 DSH 的轻量执行路径；只有观察到足够客观的证据（如连续失败 + 高不确定性 + 多个竞争假设并存）表明当前控制策略不足时，才升级到更重的认知/执行策略（Search / Deep Plan / Recovery …）。当 Router 判定"不需要介入"时，Gungnir 的性能应尽可能接近普通 DSH——这是下一阶段的 regression baseline。核心方向从"更复杂的 loop"转向"正确判断是否需要升级"，其中"知道什么时候千万不要切"与"知道该切换成什么"同等重要。
7. **方案 A 重新定义为 Baseline-Preserving Adaptive Runtime**：不是"比 DSH 更复杂的超级 Agent Loop"，而是"平时与普通 DSH 一样轻快、只有遇到确凿困难证据才自动升档"。升级路径经 Router 裁决；Branch Search 不作默认 Strategy（本次数据即其定价依据：小型单模块任务面上纯赔本）。
8. **D1–D4 双读，三阶段重估**：在保留第 4 条"Strategy API 膨胀早期信号"警戒的同时，记录正向解读——driveTurn / sub-conversation / tool filtering / shared observation 很可能正是 Adaptive Runtime 的最小通用 ISA（Gungnir Kernel 候选：GoalSpec/GoalStatus + Shared Evidence State + Strategy Host + Subconversation + Tool Surface Control + Router + Verifier），其中 shared observation（Strategy 间共享客观执行事实而非全部 reasoning history）与 ADR-0004 的 Claim ≠ Evidence 天然吻合。n=1 种 Loop 证据不足，不作单边判读，三阶段计划修订时重估。
9. **B 关联基础设施全部停止投资**：Physical Loop Hypervisor、SafePoint ABI、Loop serialization、Loop handoff protocol 从开发路径移除（ADR-0012 附录 A 的退路形态保留不删）。**重开 B 的条件（证伪即重开）**：当前证据（5 小型单模块任务 × 1 seed + baseline token 为离线估计）足以停止 B 的近期研发，但不足以永久否证所有 Physical Loop Switching 场景；仅当出现 (a) 新 Loop 无法利用 D1–D4 等通用原语干净 Strategy 化；(b) Strategy 化后产生明确质量/成本损失；或 (c) 需要真正独立生命周期/故障隔离——才重新打开本案。

### ADR-0014 loop 替换机制：disabled+insert 两步法，单实例纪律，driver 职责清单全承担（accepted，2026-08-29）

> 《二阶段实施详细计划》原预留的"ADR-0013（替换机制）"因编号被 SwitchBench 判决占用而顺延为本条（见 ADR-0013 编号说明）。机制事实权威在 [dsh-interface.md](dsh-interface.md) §16。

**背景**：ADR-0012 决定经组合接缝一次性替换默认 agent-loop，确切机制留待 OPEN-7 实证。候选：profile bundles 清单替换行 / 树外包经 dsh.bundle.patch 覆盖同 id 行。

**实证结论**（v0.1.2-alpha.1 真实 profile 运行时验证）：
1. include 插件的 patch 算法（`applyEntryPatches`）中，非 insert patch 按 id 原位修改现有行，`name` 是匹配前置条件而非覆盖值——**patch 不能改写一行的包名**；insert 是追加，同 group 内重复 id 直接 boot 失败（`duplicate loader entry id`）。
2. 可行替换机制 = **两步法**：非 insert patch 置 `agent-loop` 行 `disabled: true` + insert 自研行（`dsh-gungnir-loop`）。服务键保持 `agentLoop`（cordis Service 名 + `ctx.agents.setFactory`），消费方经 registry factory 面全部透明。
3. headless 全链路真跑：AdaptiveLoopAgent v0（原生等价 driver）完成 spec→verdict→REVALIDATION→COMPLETE→update_goal 全流程，exit 0；Gungnir 插件 pre-step 监听与 tokenMeter 在替换 driver 的 session 上正常工作。
4. **B3 首证**：同任务双 driver（默认 vs Gungnir）session log 事件词汇 17 类完全一致，turn/step 嵌套、tool/call↔tool/result 配对、request/header 先序等结构不变量双侧成立（`tools/loop-verify/compare-events.mjs`）。
5. **单实例纪律（实测教训，升格为硬前置）**：DSH 的 `TOOL_RUNTIME_SCHEDULER` 等符号线是普通 `Symbol`（非 `Symbol.for`），树外包与宿主必须解析到同一份 `@deepseek-ai/*` 模块；双副本 = 符号不相等 = scheduler 不可达。仓库侧插件与 loop 包的依赖已 junction 重指向 v0.1.2 源码树，peerDeps 锁 `0.1.2-alpha.1`（ADR-0011 第 3 条就此落地）。

**决定**：
1. 替换机制冻结为"disabled+insert 两步法 + 服务键 `agentLoop` 不变"；替代 driver 必须完整承担 dsh-interface.md §16.2 的九项职责（B3 是验收红线）。
2. 仓库包依赖纪律：任何 import `@deepseek-ai/*` 运行时符号的 Gungnir 包，其 node_modules 必须与宿主同源（junction/link 指向同一模块实例）；peerDeps 锁实测版本。
3. token 口径（OPEN-5 关闭）：M2/M3 实验以 `ctx.tokenMeter.measure()` 的 usage 锚点为准（含 cacheReadTokens），启发式仅作退路。
4. spike profile `gungnir-loop`（bundles: base + headless + dsh-gungnir-loop + dsh-gungnir）作为 Adaptive Loop 开发/实验的现役 profile。

**依据**：真实 profile 实测（本 ADR 实证结论 1–5）；`tools/loop-verify/compare-events.mjs` 对照输出；`gungnir-loop` profile `--dump-config` 与 boot 日志。

**未取代任何 ADR**；是 ADR-0012 第 2 条的机制落地、ADR-0013 第 7 条（Baseline-Preserving）的 v0 实现（EXECUTE 恒等模式）。

### ADR-0015 Adaptive Loop v0 形态冻结：三模式语义、router v0 决策表与 hysteresis 阈值（accepted，2026-08-29）

**背景**：二阶段计划 §3 要求三模式与最小防振荡（"单任务模式切换预算上限 + 同模式最少 dwell 一轮，具体阈值 M1 冻结并进 ADR"）。

**决定**：

1. **三模式 v0 语义**（全部确定性、可落账）：
   - `FAST` = 原生路径：零 Gungnir 注入（无 reconcile/verify 指令），工具面与模型档不变——Default-to-cheap 的 v0 兑现形态是"不叠加认知负担"而非削能力；模型/成本轴（cheap model、low reasoning）按 dsh-interface §15 新能力归口三阶段 model 轴。
   - `EXECUTE` = goal 工作轮：原生工具面 + Gungnir reconcile 指令（规划/执行纪律）。
   - `VERIFY` = 验证优先轮：action 已被 claim 且目标里仍有未满足的 L1/L2 谓词时，注入 deterministic-check-first 指令（证明的优先序不能反）。
2. **router v0 决策表**（有序先命中；实现在 `@gungnir/core` router.ts，纯函数，决策表全单测）：VERIFY（claim+机器谓词未满足）→ EXECUTE（action 在途未 claim）→ EXECUTE（活跃 spec）→ FAST（其余）。输入全部来自 fold 状态派生（routerInputsOf），无文本语义嗅探。
3. **hysteresis 最小件（本 ADR 冻结阈值）**：单 turn 模式切换预算 `MAX_MODE_TRANSITIONS_PER_TURN = 4`（常量在 `packages/agent-loop/src/agent.ts`）；预算耗尽保持当前模式（保持不落 transition 事件，快照如实反映）；初始选定（from=null）与 resume 后从账本现值起步不计预算。完整 hysteresis 五件套（dwell/cooldown/evidence threshold/budget/circuit breaker）仍归三阶段。
4. **loop 事件落账契约**：driver 发本地事件 `gungnir-loop/transition|state`，dsh-gungnir 插件落账 `gungnir/loop-state|loop-transition`（ADR-0005 命名空间放开，fold strict replay 校验快照一致性与 turn/step 单调）；transitionsCount 由 ledger 按 fold 派生值盖章；resume 后新 driver 实例从账本现值起步（经 `GungnirAdaptiveService.currentLoopMode`），绝不重发 from=null 初始选定。
5. **依赖方向**：`agent-loop → core`（router/类型）与 `agent-loop ← dsh-gungnir`（经 ctx 可选服务 `gungnirAdaptive` 反向供数）均不破坏 `dsh-plugin → core`、`agent-loop → core` 单向纪律；driver 在插件缺席时退化为原生路径。

**依据**：core 决策表/loop-fold 单测（101 用例）；确定性探针三件（真实 DSH 栈 + 脚本化模型：② wrapup 时序、D-12 振荡预算、D-13 resume 轨迹续写，`tools/destruction/tests/loop-driver.probe.test.ts`）；真实 profile 全链路（FAST/EXECUTE/VERIFY 三模式轨迹冷重建，state.md 工作块记录）；B3 双 driver 事件语义对照 PASS（router 活跃后复验）。

**未取代任何 ADR**；细化 ADR-0012 第 2/5 条与 ADR-0013 修订第 6/7 条的 v0 落地口径。

## 决策模板

新增决策时使用：标题、状态、日期、背景（为什么必须选）、决定、依据（文档章节/实测数据）、被取代的 ADR（如有）。
