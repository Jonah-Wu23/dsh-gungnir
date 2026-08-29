# AGENTS.md — dsh-gungnir 仓库智能体指令

> 本文件对**所有阶段、所有会话**生效（人与 agent 一体遵守）。它是纪律层，不是知识层：细节文档一律按 `docs/context/README.md` 的渐进式披露路径取，禁止凭本文件脑补实现。

## 1. 项目身份

**Gungnir**（冈格尼尔，奥丁的矛）是 DeepSeek Harness（DSH）的 **Evidence-Guided Agent Control Plane**（ADR-0017 定名；前身为"自适应目标导引系统"）：默认让 DSH 原生 loop 自己跑，Gungnir 在旁观察目标、证据与异常，只有证据表明执行失灵才介入。产品原则：**能正常干活就别管，悄悄验证，有证据出问题才出手。** Slogan 保留 **Lock the goal. Adapt the loop. Prove the hit.**（言出必行）——其中 "Adapt the loop" 对应的 Always-on Adaptive Runtime 形态已被否证落档（ADR-0016/0017），冻存为罕见调用的 escalation 后端资产。

三面职能：

- **Lock the goal**：GoalSpec，版本化目标契约，由 harness 持有，模型不能"忘掉"。形式化强度渐进（L0 隐式目标 / L1 轻量判据 / L2 完整契约，见 AP-3），不再默认要求主 Agent 起草完整 GoalSpec。
- **Prove the hit（主战场）**：Evidence + Verifier 阶梯 + Reconciler。模型输出永远只是 claim，只有 harness 观测能裁决"命中"。判定尽量复用已发生事实，正常任务追求零额外 LLM 往返。
- **Observe / Intervene**：被动监听 session 事件与工具结果（wrapup seam 是天然的验证钩子），通过即静默；仅在确定性证据冲突时发出一条面向任务的反馈。重型策略（Adaptive Loop Runtime / Branch Search / Recovery）冻存为 escalation 后端资产，默认不加载，亦不继续 patch。

分层图（全仓库唯一分层真理，任何代码必须能回答自己在哪一层）：

```text
┌─────────────────────────────────────────────┐
│ Gungnir GoalSpec / Goal Contract            │  Lock the goal：什么必须成真？
│ （渐进式形式化：L0 隐式 / L1 轻量 / L2 完整） │
├─────────────────────────────────────────────┤
│ Gungnir Adaptive Loop Runtime               │  Adapt the loop：现在该怎么干活？
│ 【冻存为 escalation 后端，默认不加载】        │  （ADR-0016/0017；重开须另立 ADR）
├─────────────────────────────────────────────┤
│ Gungnir Evidence / Verifier / Reconciler    │  Prove + Observe：被动取证，静默验证，
│ （+ wrapup 验证钩子 + 最小介入反馈）          │  有证据出问题才出手
├─────────────────────────────────────────────┤
│ DSH Agent Contract / Session Log / Services │  稳定机制层（不改源码，driver 可配置替换）
├─────────────────────────────────────────────┤
│ Tools / LLM / Sandbox                       │  实际操作层
└─────────────────────────────────────────────┘
```

方向权威：2026-08-28 全面掉头（ADR-0012），依据 `docs/idea/Agentloop自动调整【重新思考版】.md`；2026-08-29 战略裁决双落档（ADR-0016 否证 Always-on 形态；ADR-0017 修正归因为"协议税而非验证税"，定位定名 Evidence-Guided Agent Control Plane，冻结架构原则 AP-1～AP-6，禁用 L4）。路线（详见 `docs/plan/全阶段实施计划.md`）：一阶段证据基石（已完成）→ 二阶段 Adaptive Loop Spike（已完成：工程全过、冻结门 FAIL 熔断；post-mortem 完成成本三分解）→ 三阶段 Passive Prove 主线 + Passive Proof Spike（唯一幸存假设的检验）→ 四阶段生态发布。

## 2. Gungnir 铁律（违反任何一条即返工）

1. **Everything is a Plugin，loop 也是**：绝不修改 DSH 源码，绝不 fork DSH。默认 agent-loop 经 DSH 官方组合接缝**一次性整体替换**为 Gungnir Adaptive Loop Runtime；任务过程中切换的是 Loop Strategy，不是 loop 对象。禁区只有 rewrite history；replace execution policy 是 DSH 架构明示的合法操作（DSH 官方文档：agent loop 与其他部件一样可从配置替换）。（2026-08-29 注记：替换能力已实证，但 Always-on 替换形态经 ADR-0014/0016 否证熔断、ADR-0017 冻存为 escalation 后端资产——默认配置不得替换默认 loop，重开须另立 ADR。）
2. **Session log 是唯一持久权威**：模型可见的状态必须能从 session log 重构。ledger 用 durable 事件（append-only），fold 走 strict replay——畸形事件、断序、非法转换立即抛错停在坏事件处，绝不静默跳过或猜测修复。（载体勘误，ADR-0006：Gungnir 自有 ledger 走 `ctx.storage`——实测 session log 白名单封闭，自定义事件类型无法通过 resume；append-only + strict replay 纪律不变。）
3. **Claim ≠ Evidence**：模型输出永远只是 claim；只有工具结果、exit code、文件状态、外部环境观测才可能成为 evidence。verdict 只能由 Verifier 依据 evidence 裁决。模型谎报完成时，系统的正确行为是被证据拦下。
4. **Verifier 阶梯原则**：能用 L1（deterministic）绝不用 L2，能用 L2 绝不用 L4（semantic）。LLM rubric 永远标记低可信，且不足以单独支撑最终 PASS。每一级判定都要留下 evidence locator。（2026-08-29 禁用令，ADR-0017：L4 在当前模型+引擎路径下 rubric 解析率 0/3，即刻从生产候选路径禁用；经 100–500 case 独立 benchmark 证成前不得恢复。）
5. **Propose / Authorize 分离**：模型有建议权（plan、claim、complete/blocked、loop transition 提议），Harness 有裁决权；meta-controller 的转换裁决只依据 evidence 与预注册规则。sandbox、approval 等安全 authority 归原 owner，Gungnir 不得抢走。
6. **Goal 稳定，Strategy 多变**：GoalSpec 是版本化的长期真理，plan 只是 rolling-horizon 投影；Loop Strategy 随任务状态切换，Loop State 与 Goal State 严格分离，ledger schema 已预留 `gungnir/loop-state`、`gungnir/loop-transition` 命名空间，不得挪用。
7. **任何自动切换必须有 hysteresis**：dwell、cooldown、evidence threshold、switch budget 缺一不可。loop thrashing（控制器振荡）是动态 loop 的头号敌人：meta-loop 自己烧 token 就是失败。
8. **熔断是命令不是建议**：阶段熔断条件触发即停，写复盘，走降级路径。禁止"再加一个 patch 试试"式续命。
9. **禁止物理热插拔**：loop driver 实例在 session 生命周期内稳定；绝不在 open turn、open step、pending tool call、active AbortSignal 下做实例级替换，也不允许并发双 driver。机制层（Agent contract、session identity、append-only ledger、tool safety、cancellation、persistence/replay、observability）保持稳定，策略层才允许激进变化。

## 2.1 架构原则（ADR-0017 冻结，与铁律同级执行）

总原则：**Do not control what is already working. Verify it quietly. Intervene only on evidence.**（能正常干活就别管，悄悄验证，有证据出问题才出手。）

- **AP-1 Fast path must not pay control-plane tax**：正常执行路径不得为高级控制能力持续买单。普通任务的 Gungnir 开销目标：token ≤ +5–10%、额外 LLM 往返 ≈ 0。达不到就降级能力，不许反过来加协议。
- **AP-2 Agent must never debug its supervisor**：Agent 不应读取或推理 Gungnir 内部控制状态（ledger、reconciler 决策、verifier 内部错误）来恢复正常执行。出现此现象即控制面 API 设计失败——修控制面，不让 Agent 考古。
- **AP-3 Formalization must be progressive**：Goal Contract 强度按任务风险分级——L0 隐式目标（通用不变量，零协议）、L1 轻量判据（一次性捕获，至多 1 个额外往返）、L2 完整契约（高风险长任务）。禁止默认满配。
- **AP-4 Evidence should trigger verification, not plan position**：新 Evidence 到达即重评受其影响的全部 criteria；禁止 criterion starvation（因当前 committed action 未瞄准某判据而永不验证它）。
- **AP-5 锁目标，不锁手脚**（Goal commitment constrains outcomes, not actions）：本条是铁律 6 与 ADR-0013⑥ 的执行修正，非方向变更——plan 是 rolling-horizon 投影，现实证据允许局部偏离 committed action；目标承诺管结果，不管路径。
- **AP-6 裁决面向任务，不面向协议**（Minimal Actionable Feedback）：介入反馈只说任务级事实（哪条证据与 claim 冲突、还差什么），不暴露 GoalSpec / round / reconciler 等控制面内部概念；内部细节进 ledger，不进 prompt。

## 3. 宿主全局指令沿用（收录自 `C:\Users\JonahWu\.agents\AGENTS.md`）

以下为项目开发期间同样生效的宿主级准则，原文收录：

### 3.1 最高准则：Let It Fail, Let It Go

**Let It Fail（暴露真实）**：
- 严禁吞异常、伪造成功或用兜底文本掩盖未执行任务。
- 联调必须基于真实服务与配置（尽量减少离线单测）；测试失败如实报错，严禁为跑通测试在生产代码中打补丁；修复直击根因。
- UI 可转译错误提示，但严禁篡改失败状态与底层错误日志。

**Let It Go（信任模型）**：
- 严禁在脚本/代码层用正则、探针或关键词检测限制/改写模型意图与措辞；禁止维护意图关键词词典。
- 代码只做协议格式校验与沙箱安全，不做任何语义猜测。

> Gungnir 语境的特别说明：Verifier 的 L4 semantic 判定是**公开声明的 LLM 评审**（有 schema、有 prompt hash、标记低可信），不属于被禁止的"代码层语义猜测"；被禁止的是在代码里用关键词/正则偷判模型意图。两者边界不得模糊。同理，meta-controller 的模式路由规则是**公开声明、可审计、可落账**的控制逻辑，不属于偷判模型意图。

### 3.2 运行与子代理限制

- 工作流：严禁使用 `superpowers` 工作流，仅借其思路。
- 仅限子代理的约束：严禁使用 K3 及 K3-256K 模型；严禁开启最高思考挡位。

### 3.3 未收录部分

全局 AGENTS.md 中的"文书写作风格（CV/SOP）"与申请类宿主上下文与本仓库无关，未收录；宿主联系目录见全局文件原文。

## 4. 上下文纪律（渐进式披露）

- 进入仓库的任何会话，**第一步读 `docs/context/README.md`**，按其中的读取路径矩阵按需取材，禁止上来全量阅读仓库或 `docs/idea/` 全文。
- `docs/idea/` 是思想源文档（只读，不修改）；日常开发引用结论而非重读原文。现有四篇之间方向结论冲突时，以最新 ADR 为准（当前为 ADR-0016/0017；ADR-0012 是掉头起点）。
- DSH 接口事实的唯一来源是 `docs/context/dsh-interface.md`；发现与实际行为不符时，以实测为准并回写该文件（附验证方式与版本号）。

## 5. 工程规范

- **语言与形态**：TypeScript（strict）、ESM；插件遵循 cordis 结构（`apply(ctx)` + 显式 inject + Schema config）；域逻辑放 `@gungnir/core`（零 DSH 依赖的纯函数），DSH 适配放插件包。
- **包划分**：`@gungnir/core`（域纯函数）+ `dsh-gungnir`（证据/裁决/调和层插件，Prove + Observe 主线）+ 二阶段新增 `@gungnir/agent-loop`（Adaptive Loop Runtime 驱动包；发布名候选 `dsh-gungnir-loop`，四阶段定；**2026-08-29 起冻存为 escalation 后端资产：默认不加载、不继续 patch，资产保留不删，ADR-0017**）。一律树外插件形态，不碰 DSH 源码。
- **包 README**：每个包的 README 含 Contract（做什么/不做什么）与 Known Limitations 小节，文风对齐 DSH 上游。
- **决策先于代码**：架构级选择先落 ADR（`docs/context/decisions.md`）再动手；执行中推翻旧决策时新增 ADR，不删除旧的。
- **测试**：core 全单测（fold/决策表/路由规则全覆盖）；集成必须真实 profile + headless 冒烟，不做离线 mock 联调；破坏测试（进程 kill、重启、环境漂移、策略振荡注入）是第一等用例，进 CI 脚本。
- **提交**：conventional commits（`feat/fix/docs/refactor/test/chore`）；一次提交一件事。
- **DSH 版本**：peerDependencies 锁实测过的版本（当前基线 `0.1.2-alpha.1` **源码构建**——npm 未发布，源码树在仓库根 `deepseek-harness-dsh-v0.1.2-alpha.1/`，全局 `dsh` 经 `tools/dsh-shim/` 转发到其构建产物，ADR-0011）；上游演进或正式发布后先跑 `docs/context/dsh-interface.md` 的接缝回归清单再动新特性。

## 6. 状态与文档更新义务

- 每个工作块结束：更新 `docs/context/state.md`（做了什么/进行中/下一步/阻塞）。
- 改架构或模块边界：同步 `docs/context/architecture.md`。
- 新术语进 `docs/context/glossary.md`；文档之间链接优于复制。
- 阶段结束：写 stage report，修订下一阶段计划，更新全阶段计划的状态行。
