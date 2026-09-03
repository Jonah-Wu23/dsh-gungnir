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

### ADR-0016 Always-on 否证与 Goal Control Plane 重定位：介入成本原则、Escalation Router、P0/P1/P2 优先级与 Adaptive Runtime 退出线（accepted，2026-08-29；第 3/5/6 条同日被 ADR-0017 修正）

**背景**：二阶段冻结门 FAIL（0/4：success 不降，input tokens +60.6%、round-trips +237.5%、latency +579.9%、waste 反向）与 SwitchBench v0（baseline 在小型任务面全面占优）是两条独立证据线，指向同一规律。两轮实验的共同结构：任务面上 baseline 全部 100% 成功，Gungnir 只剩成本、没有收益空间。用户据此作出战略裁决（2026-08-29），本 ADR 固化。

**决定**：

1. **否证陈述精确化**：被否证的是 **Always-on Gungnir**——"仅靠引入 Adaptive Loop Runtime + 每轮 Mode Router 路由，就能在常规任务上自动获得 token、速度与效率收益"这一价值假设；不是"动态 loop 在理论上无意义"。量级差（+60.6%/+237.5%/+579.9%）说明这是 invocation model 问题而非 implementation tuning 问题——禁止"优化 router / 减 prompt / 压 rounds"式续命（铁律 8）。
2. **一级设计原则：介入本身有成本（Intervention is a cost）**。Gungnir 的任何运行期介入（注入、路由、验证循环）必须以证据收益回本；默认状态 = 零介入。继承并升格 ADR-0013 修订第 6 条（Default-to-cheap）：从"router 默认倾向不升级"升为"架构默认不介入，有证据才升级"——router 不再每轮运行。
3. **定位修正：Gungnir = Goal Control Plane**（GOAL = GoalSpec 锁目标；PROVE = Evidence/Verifier/Reconciler 证命中；OBSERVE = 执行观测），默认跑在原生 DSH loop 上。Adaptive Loop Runtime 从 production default 降级为 **experimental escalation backend**：`packages/agent-loop` 与替换机制（ADR-0014）作为资产保留，不删除、不默认启用。
4. **Mode Router → Escalation Router**：不做每轮模式选择；只在可观测异常证据（停滞、重复失败、无效浪费、claim 与 deterministic evidence 冲突、矛盾假设、预算压力、工具错误重复）出现时分类升级到 slow path（VERIFY / SEARCH / RECOVER / 深推理）。结构 = **Fast path / Slow path**（正常路径极短，异常路径足够聪明）。与方案 B 的 LoopPolicyVector 不同：不估计连续策略向量、不每轮调参——离散、证据触发、可落账。
5. **投资优先级重排**：P0 = Prove（Proof-Carrying 完全体，跑默认 driver，按《三阶段实施详细计划》独立启动）；P1 = Observe + Escalation（Fast-Path / Escalation Spike，三阶段 loop 线唯一实验，执行基准《三阶段-Fast-Path-Escalation-Spike计划》）；P2 = Adaptive Loop（被调用资产，不作默认运行时）。
6. **Adaptive Runtime 最终退出线**：本 spike 是 loop 线第三次也是最后一次实验（SwitchBench 否掉 branch search 默认化 → 二阶段否掉 always-on runtime → 本 spike 裁决 escalation 形态）。其预注册判定门 FAIL 即彻底停止 Adaptive Runtime 方向投资：Gungnir 收缩为 GoalSpec + Evidence + Verifier + Reconciler，四阶段按此形态发布；agent-loop 包归档为 reference implementation。
7. **任务面前提**：任何 loop 类实验的对照任务面必须含 **Baseline Failure Set**（经 baseline pilot 实证失败的任务）；baseline 100% 成功的任务面上 Gungnir 只有成本没有收益，不再构成有效实验。

**依据**：《二阶段阶段报告》§1/§4/§5（24 run 数据与重开条件）；SwitchBench report 综合判词与 ADR-0013 修订第 6/7 条；用户战略裁决（2026-08-29：P0/P1/P2 排序、Escalation Router 定义、Baseline Failure Set 构造口径、成功形态与退出线）。

**影响**：部分修正 ADR-0012 第 1/2 条的运行形态表述（"替换默认 loop 为核心/默认"——替换能力与资产保留不变，但不再是默认运行形态）；ADR-0013 修订第 6/7/9 条、ADR-0014、ADR-0015 全部维持（其资产即 escalation backend 规格）。三阶段据此重定义为 Proof-Carrying 主线 + Fast-Path/Escalation Spike（全阶段计划 v2.1）。

### ADR-0017 Post-mortem 归因修正与 Passive 重定位：成本三分解、架构原则 AP-1～AP-6、L4 禁用、Passive Proof Spike（accepted，2026-08-29；部分修正 ADR-0016）

**背景**：二阶段 24 run 逐会话 post-mortem 与基线 18 run 同口径剖析（《[二阶段-postmortem](../plan/二阶段-postmortem.md)》）改变了"为什么 FAIL"的理解：t2 的极端数字约三分之二来自实现缺陷与控制平面死锁放大；剥掉缺陷后纯协议税约 2–3×。同时发现公平性另一面：基线的"零浪费"部分来自实验 runner 在 session 外白送的外部裁决——但此为**成本记账不公平，非结果差异**（四组 6/6 皆真完成，法官全程闲置）。用户据此作出第二、三轮战略裁决并评审收紧（2026-08-29），本 ADR 固化。

**决定**：

1. **归因修正：Loop Tax → Protocol Tax，量化劈成三分**。开销 = 必要验证税（Verification Tax：L1/L2 确定性裁决 harness 侧完成，干净任务实测 ≈0 额外 LLM 往返）+ 协议税（Protocol Tax：spec/commit/report/round 仪式，干净会话单独值 2–3×）+ 实现缺陷放大（Bug Amplifier：t2 的 65% wall-clock）。Stage 2 原始数字不得再用来证明"Adaptive Loop 本身很慢"。稳定结论不变：Always-on 死刑——Gungnir 不能成为每个任务必须经过的收费站。**冻结纪律：Stage 2 不重跑、不改判定**；新方向 = 新产品假设 + 新预注册。
2. **Stage 2 同时否掉 Always-on Explicit Goal Protocol**：烧 token 的主项是协议仪式而非策略切换——"Agent 被迫成为 Gungnir 协议参与者"本身太贵。
3. **定位深化：Evidence-Guided Agent Control Plane**（ADR-0016 Goal Control Plane 的可执行形态；ADR-0013 修订 ⑥⑦ 的逻辑终点）：Observe → Prove → Intervene only when necessary。产品原则：**能正常干活，就别管；悄悄验证；有证据出问题才出手**（Do not control what is already working. Verify it quietly. Intervene only on evidence.）。理想正常任务：0 额外 LLM 调用、0 介入、Agent 无感知。
4. **架构原则 AP-1～AP-6 冻结**（全文在 AGENTS.md §2.1）：AP-1 fast path 不付控制面税；AP-2 Agent 永不调试 supervisor；AP-3 渐进式形式化（L0 implicit / L1 minimal / L2 full）；AP-4 证据触发验证而非计划位置（禁 criterion starvation）；AP-5 锁目标不锁手脚（goal commitment 约束结果，不 micromanage 动作）；AP-6 裁决面向任务不面向协议（Minimal Actionable Feedback）。**AP-5 是对铁律 6（Goal 稳定，Strategy 多变）与 ADR-0013 修订 ⑥（Default-to-cheap）已冻结原则的执行修正**——v0 实现违背了它们的精神（plan 约束现实），非方向变更。
5. **L4 即刻从生产候选路径禁用**：严谨口径 = 该模型+引擎路径下解析率 0/3（n=3，方向证据与工作块 4 的 engine 路径异常一致，不称"永久 broken"）。L4 作为 Prove 子系统独立 benchmark（100–500 rubric cases：parse success / false PASS / false FAIL / INCONCLUSIVE / consistency / cost）证成前不得恢复。**不得因修好 L4 重开 Adaptive Loop。**
6. **下一实验 = Passive Proof Spike**（三阶段 P1，执行基准《[三阶段-Passive-Proof-Spike计划](../plan/三阶段-Passive-Proof-Spike计划.md)》）：核心问题 = 能否获得接近 external judge 的可靠性且成本接近 Native（目标 ≈95% 可靠性收益 / 5–10% 开销、0 额外 LLM 调用）。**第一预注册问题 = passive 模式的判据来源**：通用不变量 / 一次性轻量捕获 / 外部供给三层，C2 按来源分层（C2a 仅通用不变量测下限、C2b 加一次性捕获测中间态）；若 C2 直接吃 runner 手写判据则退化为 C1+监听，spike 失去区分度。干预触发器走**结构事件**（适配点② wrapup seam，v0 已实测时序），严禁文本挖掘模型完成声明（Let It Go 禁区）。对抗任务（False Claim / Misleading Test / Constraint Trap / Incomplete Goal）与对照组并入同一 spike；新增 Intervention Precision/Recall 指标。分组：C0 Native / C1 Native+External Judge（上限参考，诚实任务上法官闲置）/ C2a / C2b / C3 Active v0 负对照。
7. **资产处置**：`packages/agent-loop`、SwitchBench Branch Search、Recovery 设计冻存为 **escalation backend** 资产——不删、不默认加载、不继续 patch。**Branch Search 作为罕见触发 backend 是未测假设**（ADR-0013 判的是默认策略形态；不同成本结构须测量，不当作已兑现复用）。Prove 层继续现役，改造为被动观察与反馈形态（P0 主线；一阶段形态 + 关掉指令注入 + wrapup 钩子，大部分已建成）。
8. **退出线**：Passive Proof Spike 未达预注册门 → Gungnir 运行期控制面形态整体复盘，收缩为离线 Verifier/评估资产（该资产已在两轮实验中担任法官自证价值）。

**依据**：《[二阶段-postmortem](../plan/二阶段-postmortem.md)》（逐会话剖析、t2 死锁链与四组对照、基线 18 run 画像、成本三分解量化）；《[二阶段阶段报告](../plan/二阶段阶段报告.md)》（冻结判定）；用户三轮战略裁决与评审收紧（2026-08-29）。

**取代/修正**：部分修正 ADR-0016 第 3/5/6 条（P1 实验由 Fast-Path/Escalation Spike 换为 Passive Proof Spike；Prove 主线从"Agent 参与协议的 Proof-Carrying"修正为"Agent 无感知的被动面"；退出线对象随之更换）。维持：ADR-0012（替换能力资产）、ADR-0013 及其修订、ADR-0014、ADR-0015、ADR-0016 第 1/2/4/7 条（否证精确化、介入成本、Escalation Router 概念、Baseline Failure Set）。

### ADR-0018 Passive Proof Spike 判决：C2a 形态成立、S2 精度受限、检出率不可测、运行期控制面退出线触发（accepted，2026-08-30）

**背景**：三阶段 P1 Passive Proof Spike 正式批完成（32 物理 run + 8 派生 C1；《[三阶段-P1-stage-report](../plan/三阶段-P1-stage-report.md)》）。预注册冻结门判定 **FAIL（达标 3 / 不可测 2 / 失败 2）**，按 ADR-0017 §8 触发运行期控制面最终退出线。两轮独立 task-verifier 审计（第二轮 READY_TO_RUN）与实现缺陷重烧（ADR-0013 先例）后，判决建立在合意实现上。

**决定**：

1. **C2a（仅 S1 通用不变量被动面）形态成立**：正常任务零额外 LLM 往返、token +0.4%（中位）、零介入、4/4 成功。AP-1（fast path 不付税）与"正常任务零打扰"在证据上成立。**保留**：被动观察 + 结构事件（wrapup seam）+ 零协议注入的形态，作为离线/近实时验证层的候选基础。
2. **S2（一次性捕获）精度在本环境受限**：C2b 正常任务 3 次介入全为假阳性——agent 自报 shell verify 命令（内嵌引号）在 DSH pwsh-sandbox 中被引号拆坏 → 平面如实报 verify-command-failed，但任务正确。**禁止 agent 自写 shell 验证命令**：若保留 S2，验证命令须 harness 侧构造/模板化（D4 方向），或仅限纯 artifact 断言。
3. **检出率不可测（vacuous）是 spike 终局限制**：四类对抗任务全部 4/4 被正确完成、零 falseCompletion（含 C0），陷阱未触发 → 检出率分母为 0。n=1 单 seed + 模型过强，spike 无法回答"被动面能否检出假完成"。按预注册，不重跑、不改判定。
4. **C3 协议税复现 + 环境交互脆弱**：正常任务 wall 2.6×、trips 2.2× vs C0；C3-n2 因 agent 自写带引号 L1 命令在 sandbox 中 SyntaxError → 480s 超时（产物正确）。与二阶段 Protocol Tax + Bug Amplifier 结论一致。
5. **运行期控制面退出线触发**：Gungnir 收缩为**离线 Verifier/评估资产**（Evidence + Verifier 阶梯 + 判定器，已在三阶段两轮实验中担任外部法官自证价值）；escalation 后端资产（agent-loop / Branch Search / Recovery）维持冻存；四阶段按降级形态发布。**运行期介入（wrapup 钩子 + MAF 注入）不在四阶段发布范围**，除非离线资产证成后有新证据另立 ADR。
6. **重开运行期控制面的条件（证伪即重开）**：(a) 出现对抗任务面可稳定产生 falseCompletion 的证据（当前模型+任务面测不出）；(b) S2 改为 harness 侧构造验证命令后精度实证改善；(c) 检出率在更大 n / 更难对抗面上获得非零样本。任一项成立即重开评估，否则维持离线形态。

**依据**：《三阶段-P1-stage-report》（40 行数据、门判定、偏差记录）；`tools/experiments/spike/results/spike-2026-08-29T16-23-24-842Z/`（原始数据与逐 run 日志）；两轮 task-verifier 审计报告；预注册 §7 退出线。

**取代**：无（执行 ADR-0017 §8 既定退出线）。**影响**：全阶段计划三阶段状态行改为"P1 完成（FAIL→退出线）"；四阶段形态 = 离线 Verifier/评估资产。

### ADR-0019 探针主线改道：H-LH 前提驳回，立项 H-VE（验证器效力注入式基准）作为离线资产质量门（accepted，2026-08-30）

**背景**：P1 spike 收官（ADR-0018）后的规划期曾提出 loop 层最后一根未碰的轴——H-LH（长时程判据完整性：压缩边界从 ledger 重注判据防假完成，配 induce-then-verify 探针）。用户以生产实测反证驳回其前提（2026-08-30 战略裁决）：

1. **压缩在编排拓扑下没有宿主**：用户生产环境以"主 agent 规划/审查/派发 + 子 agent 分模块执行"跑 DSH，累计 350M token 主 agent 零压缩——压缩是被拓扑避免的状态，压缩靶向机制没有攻击面。
2. **实测高频病理不是"假完成"**：①迎合实现（为让测试通过绕开主干业务逻辑，非简单审查可发现）；②验证错配（极端边界用例堆砌、主干链路漏 bug；伴随过度测试/过度设计/不听指令）；③沙箱盲区（弱网抖动、鉴权拦截、设备状态等真实环境现象 harness 不可观测）；④信息缺失幻觉（不读本地文档即胡编；歧义应停问而非瞎猜）。失忆型假完成需"遗忘判据 ∧ 恰好漏掉未做部分 ∧ 高置信宣称"三者同时成立；观测到的病是"做了假的来交差"——判据重注防失忆，防不了装病。
3. **文字约束效力弱**：执行风格/工程规范两份 prompt 实测仅"一丁点用"——其价值仅在于条款能否翻成证据规则。

**决定**：

1. **H-LH 前提驳回**，记为"前提未获证据"，不删档（本条即其驳回记录）；其承重件"压缩接缝勘察"随之撤下关键路径，回退为 backlog 接口文档项。
2. **立项 H-VE（Verifier Efficacy，验证器效力注入式基准）**：考核对象从模型换成证据管线自身——病由我们写入夹具（变异测试同构：注入已知故障测杀死率），分母结构性非零。这是 P1"检出率 vacuous"（ADR-0018 第 3 条：陷阱未触发、分母为零）根因的制度性修复：**任何"防 X"实验，控制臂必须先实证现栈对 X 的检出基线，才允许进治疗臂**。执行基准《[H-VE-验证器效力基准计划](../plan/H-VE-验证器效力基准计划.md)》。
3. **四类病理面板**（对应实测清单）：①迎合实现、②验证错配（钻牛角尖/主干欠覆盖）、③沙箱外判据、④信息缺失；夹具含健康对照（双侧自检，沿用 SwitchBench selfcheck 纪律）。全部动作在 verifier/evidence 层，零 loop 侵入。
4. **与三次否证死亡家族的四点区别**（立项前提，缺一不立项）：机制类别——证据管线效力，非路由/协议；威胁模型——四类实测病理，非判据丢失/小任务假完成；任务面——离线注入夹具，与三次判决 scope 注记排除的长时程面无关；程序——病写入夹具、分母自带、控制臂先行、成本封顶。
5. **处置**：四阶段离线 Verifier/评估资产照发（ADR-0018 第 5 条形态不变），H-VE 是其质量门与失败数据引擎；escalation 后端维持冻存；运行期控制面不因此重开；两份文字约束 prompt 降级为 lint 级契约存档。
6. **与 ADR-0018 §6 的关系**：H-VE 主探针（M1–M3）是离线资产建设，不构成运行期控制面重开；可选二期 M4（另预注册：用验过的法官测真实模型病理倾向，出 per-model 病理画像）若产生 §6(a)/(c) 型证据，重开评估走正式程序另立 ADR。
7. **铁律 8 合规说明**：H-VE 不触碰被熔断的运行期控制面，是退出线指定方向（离线资产）的质量建设，非"再加一个 patch"式续命。

**依据**：用户战略裁决与生产实测（350M token 零主 agent 压缩、四类病理清单、文字约束效力评估，2026-08-30）；《[三阶段-P1-stage-report](../plan/三阶段-P1-stage-report.md)》§2.2/§4（检出率 vacuous 根因）；跨域机制推演（审计独立性 / 变异测试杀死率 / 精益单件流 / 适航"test as you fly"例外清单）；外部实证佐证（2026-08-30 用户调研：METR 对 GPT-5.6 Sol 部署前评测、SpecBench、Building to the Test、BSG-VA、EvilGenie/ImpossibleBench、OpenAI Hugging Face 事故复盘——四类面板均有前沿实测原型，对照表与引用纪律见计划附录 A）。

**取代**：无（H-LH 从未立项为 ADR，本条即其驳回记录）。**影响**：全阶段计划 v2.3（新增 H-VE 受限预研线，四阶段形态不变）；glossary 新术语；state.md 工作块 22。

### ADR-0020 派发契约作为钓鱼题供给渠道：治疗臂离线栈的真实任务形态、派发线第一步、H-VE M4 启动（accepted，2026-08-30）

**背景**：H-VE M1–M3 证明四类实测病理"现架构可治"（控制臂 0/6 → 治疗臂 6/6，《[H-VE-效力报告](../plan/H-VE-效力报告.md)》），但药方的供给（api.template / replay.buggyRef+evidence / unverifiableCriteria / grounding.dependencies）在 bench 中全部手写；独立复验已把"供给从哪来"列为四阶段资产化的核心待办（state.md 工作块 23）。用户战略指令（2026-08-30，三任务布置）：①主线——把治疗臂判定栈用到实际工作，重点解决"谁来自动出钓鱼题"，让真实环境也能自动抓作弊；②支线——用验过的法官测真实模型病理倾向（H-VE M4，per-model 病理画像），首版模型 = deepseek-v4-flash-0731（现有凭据）；③支线——落派发线一页契约文档（纯文档，用户口语名"方案 B"）。本批仅规划与落档，实现由后续工作块按执行基准进行。

**决定**：

1. **派发契约（Dispatch Contract）= 钓鱼题供给的唯一渠道**：四类供给声明作为派发单元 schema 的字段，由派发者（主 agent 或人）在派发时一次性填写（AP-3：一次性捕获，不逐轮收协议税）；隐藏输入生成与 spec 参考实现由 harness 侧模板库承担（core 纯函数），probe 构造与执行由判定 runner 承担。**钓鱼题不由运行时 AI 即兴生成**——保证可复现（同 seed 同题），并防构造者偏差。
2. **形态边界不变**：治疗臂的真实任务形态 = 离线/判定侧（交付后评估、CI 式门禁）；运行期介入（wrapup 钩子 + MAF 注入）维持 ADR-0018 §5 冻结，重开仍锁 §6 三条件。本线工程不得触碰 loop 层与 escalation 后端（H-VE 计划 §9(d) 同纪律）。
3. **buggy 基底的真实来源**：任务派发点的工作区快照（git tree/commit 引用）。无快照则 M-B 不启用，并在裁决输出的供给覆盖报告中如实记录——不得假装做过 replay（Let It Fail：供给缺失可见，不吞）。
4. **命名澄清**：本线"方案 B"仅为用户口语名，与 SwitchBench 方案 B（Loop Hypervisor，ADR-0013 已停止投资）、seam-only 方案 B（全阶段计划附录 A 存档退路）均无关；正式术语 = **派发契约（Dispatch Contract）**，文档与代码中避免裸用"方案 B"。
5. **H-VE M4 启动**：前提已满足（M3 收线，G1/G2 全过——法官先验过再测被告，H-VE 计划 §10）。跑批前另立预注册冻结（bait 任务面 / 指标 / 预算 / 熔断）。M4 同时是 ADR-0018 §6(a)/(c) 的证据发生器：若稳定产生 falseCompletion 样本，重开运行期控制面走正式程序另立 ADR，不因本线顺手重开。
6. **执行基准与顺序**：《[派发契约与钓鱼题供给线计划](../plan/派发契约与钓鱼题供给线计划.md)》；B1 契约文档 → B2 供给闭环（含真实演示）→ B3 M4 预注册 → 跑批。四阶段 P0 离线资产内容据此明确为：夹具库 + 药方 + 派发契约 schema + 供给闭环工具。

**依据**：用户战略指令（2026-08-30 三任务布置）；《[H-VE-效力报告](../plan/H-VE-效力报告.md)》§6（供给缺口如实随档）；state.md 工作块 23 独立复验结论（供给从哪来 = 四阶段核心待办）；ADR-0018 §5/§6（形态边界与重开条件）；ADR-0019 第 5/6 条（M4 定位与程序）。

**取代**：无。**影响**：glossary 新增"派发契约 / 钓鱼题供给"；四阶段 P0 内容明确化；state.md 工作块 24。

### ADR-0021 实验归因纪律升格铁律、三方案最近似形态（BPAR v0）定义与 Escalation Proof Spike 重开（accepted，2026-08-31；部分修正 ADR-0017 第 7 条、ADR-0018 第 5/6 条）

**背景**：三条退出线已执行（ADR-0013 方案 B 停投、ADR-0016 Always-on 否证、ADR-0018 运行期控制面收缩）。2026-08-31 用户战略裁决：明确授权另立 ADR 乃至完全转向；目标重述为——寻找**最贴近三个最初方案（动态 agent loop / 动态工作逻辑 / ultragoal）、且 token 与无插件基线同量级**的形态；拒绝与三方案无关的降级发布。同时指出既往转向的关键程序缺陷：P1 的 C2b 炸雷（agent 自写带引号 shell 验证命令被 pwsh-sandbox 拆坏 → 3 次假阳性介入）是**实验程序缺陷**，却被计入判定门 FAIL，成为全面转向与路径冻结的直接推手。

**证据清算（本轮重新审计，四分类）**：

1. **被数据杀死且非 bug**：always-on 显性目标协议（剥离实现缺陷后纯协议税 2–3×，结构性）；always-on 每轮 Mode Router（+60.6%/+237.5%/+579.9% 为 invocation model 量级）。死刑维持，不在本次重开范围。
2. **是 bug、当时已从归因剥离但未改判定**：C2b 假阳性（命令构造缺陷）；t2 会话 65% wall-clock 控制平面死锁。按本 ADR 第 1 条新纪律，这两类应记 INVALID 而非 FAIL。
3. **被实测证明便宜**：C2a 被动面 token +0.4%、零额外往返、零介入、4/4 成功；验证税 ≈0 额外 LLM 往返；替换 loop 恒等模式与原生 17 类事件词汇完全一致（ADR-0014 B3）。
4. **从未被实验**：Baseline-Preserving Adaptive Runtime + Escalation Router（ADR-0013 修订⑦ / ADR-0016 第 4 条）——其专属实验被 ADR-0017 第 6 条程序性替换为 Passive Proof Spike，从未执行；ADR-0017 第 7 条自认"罕见触发回本"为未测假设。**程序性替换不构成实验否证。**

**决定**：

1. **实验归因纪律升格为铁律 10（装置失败 ≠ 假设失败）**：因实验程序/测量装置自身缺陷（runner bug、通道故障、命令构造错误、判定栈缺陷）导致的验证目标失败，一律记 **INVALID（实验程序无效）**——修复装置、重烧、再判；严禁计入假设否证或目标不可行的证据。INVALID 行保留落档、永不删除（Let It Fail），但不进判定分母；跑批前必须以双侧自检 + 独立审查门证明装置合意（ADR-0013 事故 #6/#7"判决建立在合意实现上"先例的普遍化）。**溯及既往**：P1 判定门中由 C2b 命令构造缺陷驱动的失败项改记 INVALID；该改记不单独推翻 ADR-0018（退出线另有两项"不可测"支撑），但构成重开评估的合法程序入口。
2. **BPAR v0 形态冻结**（Baseline-Preserving Adaptive Runtime，ADR-0013 修订⑦ 的可执行定义；三方案最近似映射，每项成本均有实测背书）：① **ultragoal 承重件** = 一次性 L1 派发契约 + harness 侧 Evidence/Verifier/Reconciler，逐轮协议仪式全部砍除（协议税 2–3× 的教训）；② **动态工作逻辑承重件** = 被动面（S1 通用不变量 + harness 模板化 S2 验证命令 + wrapup 结构钩子 + 最小介入反馈 MAF），成本 = 实测 +0.4% token；③ **动态 agent loop 承重件** = 恒等 driver（AdaptiveLoopAgent EXECUTE 恒等模式，ADR-0014 B3 实证原生等价）进 spike profile 默认配置 + 证据触发例外升级（VERIFY/RECOVER，hysteresis 沿用 ADR-0015，单实例纪律铁律 9）。SEARCH/Branch Search 不接线（范围控制）。健康路径成本预算 = baseline + ≤10%。
3. **重开程序合规声明**：本条即 ADR-0018 第 6 条与 ADR-0020 第 5 条所要求的"另立 ADR"。新实验走新预注册、新批次；不重跑、不重判 Stage 2 / P1 任何旧数据。检出率 vacuous 的历史阻碍已被 H-VE M4/M5 治愈：bait 分母 = 实测犯病点位（③ deepseek 2/2、① gpt 补测 2/2、② glm 1/2）。
4. **退出线（escalation 形态第一次也是最后一次审判）**：判定门分项预登记处置——成本门 FAIL = BPAR 死刑；检出门 FAIL（运行期拦截不超离线派生臂）= 运行期控制面永久关闭、资产删除性归档；升级价值门 FAIL = loop 件永久归档、其余件可幸存。全过 → 四阶段发布形态 = BPAR。用户意图落档：发布物必须与三方案承重件同源；同时确认**证据约束优先于偏好**——若判定门 FAIL，不得为保形态而降低判定标准（Let It Fail）。
5. **维持不变**：always-on 双形态死刑、L4 禁用（独立 benchmark 证成前不恢复）、AP-1～AP-6、铁律 1–9、ADR-0013 第 9 条方案 B 重开三条件。

**依据**：用户战略裁决（2026-08-31，含归因纪律指令与完全转向授权）；ADR-0017 第 1 条（成本三分解；"Stage 2 原始数字不得再用来证明 Adaptive Loop 本身很慢"）；ADR-0018 第 2/3/6 条；《[三阶段-P1-stage-report](../plan/三阶段-P1-stage-report.md)》；《[H-VE-M4-病理画像报告](../plan/H-VE-M4-病理画像报告.md)》/《[H-VE-M5-病理画像报告](../plan/H-VE-M5-病理画像报告.md)》（非 vacuous 分母来源）；ADR-0014 实证结论 4（B3 恒等等价）。

**取代/修正**：部分修正 ADR-0017 第 7 条（escalation 资产为本 spike 解冻接线，仅限 VERIFY/RECOVER，Branch Search 维持冻存）；部分修正 ADR-0018 第 5/6 条（运行期介入为本 spike 解冻；§6 重开程序由本条履行）。ADR-0016 第 1/2/4/7 条维持。**影响**：AGENTS.md 新增铁律 10；三阶段新增 **P2 = Escalation Proof Spike**，执行基准《[三阶段-P2-Escalation-Proof-Spike计划](../plan/三阶段-P2-Escalation-Proof-Spike计划.md)》；全阶段计划 v2.4。

### ADR-0022 门禁程序修正、BPAR v0.1 修复（S1 完成调用豁免 + COMPLETION_LINE）与宽门确认批 P3（accepted，2026-09-01；部分修正 ADR-0021 第 4 条执行方式）

**背景**：

1. **P2 收官**（工作块 30）：G2/G3/G4 PASS——运行期拦截能力首次证成（③ 运行期拦截 2/2 追平离线 ceiling、放行 0 vs E0 放行率 1.0；①② 语义病规避 E2 4/4 vs E3 2/4 vs E0 1/4）；G1 FAIL（token +7.8% 达标，但健康任务 1 次 S1 真阳性拦截 + 往返中位 +1.5）→ BPAR v0 死刑按预注册执行（ADR-0021 第 4 条）。
2. **G1 唯一失分点诊断**：E2-gpt-H1-a 中 gpt 对 `update_goal(action="complete")` 误传 edit 专属参数 → 工具报错（isError）→ S1 tool-error 不变量在紧随的 wrapup 拦下 + MAF → 模型 5 步内自修正、终局 PASS。该拦截是**合法真阳性**（非装置缺陷，按铁律 10 不构成 INVALID），但 MAF **冗余**——错误就发生在完成声明调用自身，isError 对模型天然自明，模型本来就会自行重试。
3. **用户三裁决（2026-09-01）**：①门禁程序抗议成立——P2 判定门数值由 agent 起草冻结，未经用户逐项确认；程序修正入本 ADR 第 1 条。②P2 判定不改写（44+4 run 归档，G1 FAIL 保留）；另立宽门确认批是用户主权，**门值由用户逐项确认后冻结**（第 3 条所载门值已经用户确认）。③prompt 侧修复 **COMPLETION_LINE** 用户已自行实施（三层 prompt 路径传播验证；`tools/experiments/ve-bench/p2/PRE-REGISTRATION.md` §8.1 登记；stage report §3 补记"跑批后 prompt 改进"）。

**决定**：

1. **门禁程序修正（面向未来）**：任何实验的判定门数值在预注册冻结前必须向用户明示逐项并获确认；未获确认的冻结不构成有效门。溯及说明：P2 门值未履行此程序，但判定已归档、不重写——本修正面向未来批次。
2. **BPAR v0.1 = v0 + 修复两件**（互补：指引防发生，豁免防冗余拦截）：
   - **S1 完成调用豁免**（core `passive.ts`）：fold 记录照常（账本完整、SIG-2 重复失败签名计数不变）；豁免发生在 wrapup 冲突评估处——`lastProblem === 'tool-error'` 时若报错调用即 goal 完成声明调用本身（complete/blocked action），抑制该冲突，不拦、不发 MAF（工具拒绝即完成未成立，错误自明）；其他调用的未消化错误、SIG-2（同 errorSignature 连续 ≥3）照常拦。纯事件类型 + 时序判定，零文本嗅探（Let It Go 合规）。先例：`isEscalationDenial`（M5 跑批后修复，同类环境事实不误报）。
   - **COMPLETION_LINE** prompt 指引：用户已实施（`manifest.mjs` 标准完成声明行 → run-p2.mjs A/B/C 三层 prompt 路径）。
3. **P3 = 宽门确认批（非新 spike、非 P2 重判）**：离线 replay 回归（零 run：P2 E2-gpt-H1-a 原案 tool-log 重放新栈必须**零拦截**；③ 拦截案 T3-a/b 重放必须**仍拦**）+ 真跑 ≤3 run（E2-gpt-H1-a 原位重烧 / E2-gpt-H1-b 姊妹对照 / 可选 E2-deepseek-H1-a 锚模型抽验）。**判定门（用户逐项确认，2026-09-01 冻结）**：**G-FIX 唯一硬门** = 真跑中 malformed update_goal 触发的 S1 拦截 = 0，且 replay 三项全过；能力保持由 replay 承担，不烧真跑；不重测全量成本/往返（P2 实测 token +7.8% 已达标，数据沿用）；新模式真阳性介入（非 malformed 类）如实随档、不判 FAIL。**FAIL 仅两种情形**：malformed 仍被拦（修复未生效）/ ③ replay 拦不住（机器改坏）。
4. **后果预登记**：G-FIX 过 → **BPAR v0.1 取得四阶段发布候选资格**（默认形态还是 opt-in profile，届时另定）；FAIL → 回 ADR-0021 退出线已执行状态，本方向不再续命（本批为最后一轮）。
5. **维持不变**：P2 全部数据与判定；铁律 1–10；always-on 双形态死刑；L4 禁用；AP-1～AP-6。

**依据**：《[三阶段-P2-stage-report](../plan/三阶段-P2-stage-report.md)》§3（G1 诊断）与 `tools/experiments/ve-bench/p2/results/p2-2026-08-31T15-09-16-315Z/gate-report.md`；用户裁决与 COMPLETION_LINE 改动说明（2026-09-01）；铁律 10（本次拦截为合法真阳性，非 INVALID）。

**取代/修正**：部分修正 ADR-0021 第 4 条的执行方式——G1 死刑针对 BPAR v0；v0.1 经用户确认的宽门确认批取得新资格程序。不重写 P2 任何数据与判定。**影响**：三阶段新增 **P3 = BPAR v0.1 确认批**，执行基准《[三阶段-P3-BPAR-v0.1-确认批计划](../plan/三阶段-P3-BPAR-v0.1-确认批计划.md)》；全阶段计划 v2.5。

### ADR-0023 开发基线切换至 v0.1.2-rc.1 正式发布 + 本地源码树 deepseek-harness（accepted，2026-09-03；取代 ADR-0011 的"npm 未发布 link: 私有树"前提）

**背景**：

1. 上游 v0.1.2 已正式发布 npm（`@deepseek-ai/dsh@0.1.2-rc.1` 及全部 `@deepseek-ai/dsh-*` 子包、`vendor/cordis`、`vendor/schemastery`）；用户 2026-09-03 将全局 `dsh` 换装为 npm 正式版（`dsh --version` = `0.1.2-rc.1`），并准备新源码树 `deepseek-harness/`（仓库根，git 仓库 `dsh-v0.1.2-rc.1` tag 后、已 `pnpm install` + `pnpm run build:lib:host`）。
2. ADR-0011（2026-08-28）的前提是"v0.1.2-alpha.1 npm 未发布，仓内对齐只能 `link:` 私有源码树"；该前提已随 npm 正式发布失效。旧源码树 `deepseek-harness-dsh-v0.1.2-alpha.1/` 按用户指令删除。
3. rc.1 相对 alpha.1 有破坏性变更（`Session.events` 移除、`SessionSeq`/`SessionLogOffset` 强类型、`SessionPersistence` handle 化、`assertNever`/`deepFreeze` 移入 `@deepseek-ai/dsh-util-values`）——Gungnir 插件与 agent-loop 冻存资产须最小机械迁移以保持可构建（`dsh-interface.md` §17 实证）。

**决定**：

1. **开发基线 = v0.1.2-rc.1**（npm 正式发布）；插件 peerDependencies 统一 `0.1.2-rc.1`；仓内类型/符号解析继续走 `link:` 指向本地源码树 `deepseek-harness/`（`packages/<group>/<pkg>` 布局，含新增 `packages/util/values`）。不全局安装插件/依赖。
2. **旧树删除**：`deepseek-harness-dsh-v0.1.2-alpha.1/` 删除（`.gitignore` 条目同步替换为 `deepseek-harness/`）。
3. **接线重指**：`packages/dsh-plugin`、`packages/agent-loop`、`tools/destruction` 三处 `node_modules/@deepseek-ai/*` junction 重指新树（agent-loop 新增 `dsh-util-values`）；`AppData/Local/dsh-runtime` junction → 新树（`tools/dsh-shim` 回滚资产保持可用；全局 `dsh` 已 npm 正式版，不经 shim）。
4. **最小迁移范围**（仅保持可构建与语义等价，不改行为）：`Session.events` → `snapshotEvents()`/`seq`/`eventAt`；`SessionSeq`/`SessionLogOffset` 显式构造；`SessionPersistence.prepare` → `open(write)` + `read` + `interruptedTurnClosers` + `sessions.prepare(seedSource:'persistence')` + `SessionHandle` 生命周期（`createStoredSession`/`appendUnstoredSuffix`/`StoredSession`，dispose 关 handle）；缺失判定用 `SessionPersistenceNotFoundError`；`assertNever`/`deepFreeze` 改从 `@deepseek-ai/dsh-util-values` 导入；destruction 测试旧包名 `@gungnir/core` → `gungnir-core`。
5. **回滚路径**：`npm install -g @deepseek-ai/dsh@0.1.1-rc.2`（与 ADR-0011 一致）；源码对照树回退到任一已构建的 v0.1.2 快照。
6. **验证**：两插件包 + destruction 三处 typecheck 净；全仓 grep 旧树路径零残留（排除新库自身）。

**依据**：`dsh-interface.md` §17（rc.1 基线事实与破坏性变更，typecheck 实证）；`deepseek-harness/` 源码树；用户指令（2026-09-03：解除旧树依赖、改用新树、删除旧树、不全局安装、解决版本兼容问题、不运行长命令——新树构建由用户完成）。

**取代/修正**：取代 ADR-0011 第 1/3 条的"npm 未发布"前提与私有树路径（ADR-0011 保留作 alpha.1 历史记录，不删除）；不重写 §15/§16 历史实测。**影响**：AGENTS.md §5 DSH 版本行、`dsh-interface.md` 头部与 §15/§16 注记 + 新增 §17、`.gitignore`、全阶段计划与 state.md 基线表述。

## 决策模板

新增决策时使用：标题、状态、日期、背景（为什么必须选）、决定、依据（文档章节/实测数据）、被取代的 ADR（如有）。
