# 决策记录（ADR 索引，L1）

> 规则：先决策后代码；推翻旧决策 = 新增 ADR，不删除旧的。状态：accepted（已生效）/ proposed（建议待验证）/ superseded（被取代）。
> ADR-0001～0005 源自 `docs/idea/` 三篇文档的推演结论（2026-08-28 规划期归档）。

## 已归档

### ADR-0001 命名与发布策略（accepted）
仓库 `dsh-gungnir`（吃 `dsh-` 前缀搜索流量），品牌 **Gungnir**（单词品牌派，脱离前缀独立存在），npm 包名 `dsh-gungnir`（unscoped，对齐生态内 `dsh-better-sidebar` 等惯例）。撞名勘察：GitHub 同名均为小工具，agent 赛道无冲突；DSH 生态内 Aegis 是盾、Gungnir 是矛，不撞车。tagline："Declare it. Gungnir never misses."
依据：初步结论（高星插件命名扫描）。

### ADR-0002 先 UltraGoal Reconciler，后 Adaptive Loop（accepted）
依赖单向：Loop 控制平面所需全部信号（progress_delta/error_rate/verification_debt/evidence threshold/goal predicates）来自证据层；反向不需要。Loop 的对照实验本身需要 Verifier 层当裁判。两项目共用生死假设（证据驱动判定开放世界进展），先打这一仗信息杠杆最大。
依据：初步结论（依赖方向论证）。

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

## 决策模板

新增决策时使用：标题、状态、日期、背景（为什么必须选）、决定、依据（文档章节/实测数据）、被取代的 ADR（如有）。
