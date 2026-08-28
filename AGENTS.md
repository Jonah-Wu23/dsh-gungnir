# AGENTS.md — dsh-gungnir 仓库智能体指令

> 本文件对**所有阶段、所有会话**生效（人与 agent 一体遵守）。它是纪律层，不是知识层：细节文档一律按 `docs/context/README.md` 的渐进式披露路径取，禁止凭本文件脑补实现。

## 1. 项目身份

**Gungnir**（冈格尼尔，奥丁的矛——掷出必中）是 DeepSeek Harness（DSH）的树外插件家族：一个 durable, evidence-driven goal reconciliation runtime（证据驱动的目标协调运行时），持续把观测到的现实推向版本化的人类意图。Tagline：**Declare it. Gungnir never misses.**（言出必中。）

四层架构是全仓库唯一分层真理，任何代码必须能回答自己在哪一层：

```text
┌─────────────────────────────────────────────┐
│ Gungnir GoalSpec / Goal Contract            │  What must become true?
├─────────────────────────────────────────────┤
│ Gungnir Reconciler + Adaptive Loop Plane    │  How should I work NOW?
├─────────────────────────────────────────────┤
│ DSH Agent / Goal / Workflow / Subagent      │  Execute the chosen policy
├─────────────────────────────────────────────┤
│ Tools / LLM / Sandbox                       │  Perform actual operations
└─────────────────────────────────────────────┘
```

路线（详见 `docs/plan/全阶段实施计划.md`）：一阶段 Reconciler 骨架 → 二阶段 Proof-Carrying 完全体 → 三阶段自适应 Loop 控制平面 → 四阶段生态发布。

## 2. Gungnir 铁律（违反任何一条即返工）

1. **Everything is a Plugin**：绝不修改 DSH 的 `agent-loop` 或任何核心包，绝不 fork DSH。新行为 = 树外插件。绝不重新发明 `/goal + loop + workflow`——站在 `dsh-goal`、`goal-round-driver`、`ctx.workflowEngine` 肩膀上，只新增 GoalSpec / Evidence / Verifier / Reconciler（及三阶段的 LoopPolicy）这一层。
2. **Session log 是唯一持久权威**：模型可见的状态必须能从 session log 重构。ledger 用 durable 事件（append-only），fold 走 strict replay——畸形事件、断序、非法转换立即抛错停在坏事件处，绝不静默跳过或猜测修复。
3. **Claim ≠ Evidence**：模型输出永远只是 claim；只有工具结果、exit code、文件状态、外部环境观测才可能成为 evidence。verdict 只能由 Verifier 依据 evidence 裁决。模型谎报完成时，系统的正确行为是被证据拦下。
4. **Verifier 阶梯原则**：能用 L1（deterministic）绝不用 L2，能用 L2 绝不用 L4（semantic）。LLM rubric 永远标记低可信，且不足以单独支撑最终 PASS。每一级判定都要留下 evidence locator。
5. **Propose / Authorize 分离**（三阶段起生效，一阶段预埋）：模型有建议权，Harness 有裁决权。sandbox、approval 等安全 authority 归原 owner，Gungnir 不得抢走。
6. **Goal 稳定，Policy 多变**：GoalSpec 是版本化的长期真理，plan 只是 rolling-horizon 投影；Loop State 与 Goal State 严格分离，ledger schema 已预留 `gungnir/loop-state`、`gungnir/loop-transition` 命名空间，不得挪用。
7. **任何自动切换必须有 hysteresis**：dwell、cooldown、evidence threshold 缺一不可。禁止无阈值的"模型觉得该切就切"。
8. **熔断是命令不是建议**：阶段熔断条件触发即停，写复盘，走降级路径。禁止"再加一个 patch 试试"式续命。
9. **出现"改 agent-loop 更快"的念头时**：拒绝。要么写 ADR 论证插件方案，要么放弃该特性。

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

> Gungnir 语境的特别说明：Verifier 的 L4 semantic 判定是**公开声明的 LLM 评审**（有 schema、有 prompt hash、标记低可信），不属于被禁止的"代码层语义猜测"；被禁止的是在代码里用关键词/正则偷判模型意图。两者边界不得模糊。

### 3.2 运行与子代理限制

- 工作流：严禁使用 `superpowers` 工作流，仅借其思路。
- 仅限子代理的约束：严禁使用 K3 及 K3-256K 模型；严禁开启最高思考挡位。

### 3.3 未收录部分

全局 AGENTS.md 中的"文书写作风格（CV/SOP）"与申请类宿主上下文与本仓库无关，未收录；宿主联系目录见全局文件原文。

## 4. 上下文纪律（渐进式披露）

- 进入仓库的任何会话，**第一步读 `docs/context/README.md`**，按其中的读取路径矩阵按需取材，禁止上来全量阅读仓库或 `docs/idea/` 全文。
- `docs/idea/` 是思想源文档（只读，不修改）；日常开发引用结论而非重读原文。
- DSH 接口事实的唯一来源是 `docs/context/dsh-interface.md`；发现与实际行为不符时，以实测为准并回写该文件（附验证方式与版本号）。

## 5. 工程规范

- **语言与形态**：TypeScript（strict）、ESM；插件遵循 cordis 结构（`apply(ctx)` + 显式 inject + Schema config）；域逻辑放 `@gungnir/core`（零 DSH 依赖的纯函数），DSH 适配放插件包。
- **包 README**：每个包的 README 含 Contract（做什么/不做什么）与 Known Limitations 小节，文风对齐 DSH 上游。
- **决策先于代码**：架构级选择先落 ADR（`docs/context/decisions.md`）再动手；执行中推翻旧决策时新增 ADR，不删除旧的。
- **测试**：core 全单测（fold/决策表全覆盖）；集成必须真实 profile + headless 冒烟，不做离线 mock 联调；破坏测试（进程 kill、重启、环境漂移）是第一等用例，进 CI 脚本。
- **提交**：conventional commits（`feat/fix/docs/refactor/test/chore`）；一次提交一件事。
- **DSH 版本**：peerDependencies 锁实测过的版本（当前 `0.1.1-rc.2`）；升级 DSH 前先跑 `docs/context/dsh-interface.md` 的接缝回归清单。

## 6. 状态与文档更新义务

- 每个工作块结束：更新 `docs/context/state.md`（做了什么/进行中/下一步/阻塞）。
- 改架构或模块边界：同步 `docs/context/architecture.md`。
- 新术语进 `docs/context/glossary.md`；文档之间链接优于复制。
- 阶段结束：写 stage report，修订下一阶段计划，更新全阶段计划的状态行。
