# dsh-gungnir

**Gungnir —— DeepSeek Harness 的自适应目标导引系统。** 将"一切皆插件"的理念贯彻到底——首个动态调整底层 agent loop 的 DSH 插件。

**Gungnir — the adaptive goal-guidance system for DeepSeek Harness.** "Everything is a plugin" carried all the way down — the first DSH plugin that dynamically adapts the underlying agent loop.

> **Lock the goal. Adapt the loop. Prove the hit.**（言出必行。）

本包是 Gungnir 的 Prove 层：把 `@gungnir/core` 的证据驱动 reconcile 循环接进 DeepSeek Harness 的树外 cordis 插件。Adapt 层（替换默认 agent-loop 的 Adaptive Loop Runtime）由姐妹包 `@gungnir/agent-loop` 承担（二阶段，ADR-0012）。DSH 基线 = `v0.1.2-alpha.1` 源码构建（ADR-0011；v0.1.2 适配三件套在二阶段 M0 落地），接缝事实见 `docs/context/dsh-interface.md`。

## Contract

**做什么**

- **Ledger（ADR-0006）**：事件账本存 `ctx.storage` 的 KV unit（`gungnir-ledger` v1，`events` 表），按 `${agentId}#${seq}` 追加；v/ts envelope 由 `AgentLedger.append` 统一加盖；fold 抛错即 poisoned 并上抛（fail loud）。冷重建 = 按 key 序全量 `foldEvents`。**不用 session log 自定义事件**——DSH persistence 白名单封闭，resume 会拒载整个会话。
- **命令**：`/ultragoal <objective>`（起 spec 草案轮，模型经 `gungnir_submit_spec` 提交 + ask-user 单次确认）与 `/ultragoal --spec <path>`（YAML/JSON 手写 spec，无人值守）；`/gungnir status|verdicts|pause|resume|clear`（clear 保留 durable 历史）。
- **模型侧工具**：`gungnir_submit_spec` / `gungnir_plan`（rolling-horizon 投影，harness commit 第一个含未满足 target 的 step）/ `gungnir_report`（**claim**，落账不裁决）。
- **证据捕获**：`tools/result`（observe-only）在 EXECUTING 轮内全部落 `gungnir/evidence`（digest + locator + ≤200 字符 preview，spill 思路）。
- **Verifier（三实现）**：ExitCode L1（命令执行走 `VerifyContext.runCommand` 端口）；Artifact L2（workspace 前缀围栏内的只读检查：存在/包含/sha256/JSON 谓词；sha256 或 JSON 值漂移判 STALE → REPLAN）；LlmRubric L4（强 schema 输出 + prompt hash 入 detailRef + 结果标记低可信）。
- **Reconcile 闭环**：`agent/turn-stopping` 触发轮末验证 → verdict → `reconcile` 决策 → `gungnir/status`；ADVANCE/RETRY 由引擎机械 commit 下一轮；REPLAN/COMPLETE/BLOCKED/NEEDS_HUMAN 通过 `agent.inject` 注入指令，引导模型走 `update_goal` 合法路径——**Gungnir 不代写 native goal**；`goal/changed` 上做 phase 单向映射不一致报警（只报警不代写）。
- **续轮（ADR-0007）**：完全复用 `goal-round-driver`；pre-step 监听"追加不替换"——先 `next()` 放行驱动，再往消息尾部追加一条 `kind:'plugin'` source 的 reconcile 指令，绝不触碰 goal 源消息。

**不做什么**

- 不修改 DSH 任何核心包的源码、不 fork。替换默认 agent-loop 由姐妹包 `@gungnir/agent-loop`（二阶段）经官方组合接缝完成，本包不承担 loop 职责。
- 不代模型调用 `update_goal`（complete/blocked 都由模型在 goal round 内自行调用）；不冒充 human authority。
- 不提供 loop 策略切换与 `propose_loop_transition`（属 `@gungnir/agent-loop`，二阶段起）；不管理多 goal / 跨 session goal。
- 不私开进程执行命令（沙箱 authority 归 DSH 原 owner）。

## Composition

```bash
dsh plugin --profile gungnir-dev add <本包路径>
dsh --profile gungnir-dev --dump-config   # 装载验证
```

inject：`commands / tools / storage`；运行时另按需访问 `goals / llm / userQuestions / agents`（缺服务 fail loud）。Config：`workspaceRoot / maxGoalRounds / rubricProvider / rubricModel / rubricTimeoutMs`。

## Failure discipline

- 所有 ledger 写入先持久后内存；坏事件使该 agent 的 ledger poisoned，后续 append 一律拒绝（重启冷重建会停在同一个坏事件——诚实暴露，不掩盖）。
- 轮末 reconcile 失败：完整错误进结构化日志，ledger 停在最后一个一致事件；下一轮末重试。
- 接缝解析失败（如 storage 无 KvFacet）在插件加载时即抛出，绝不带病运行。

## Known Limitations

- **v0.1.2 适配三件套未落地**（二阶段 M0 先行项，ADR-0011）：插件 patch 的 storage 插入行与 v0.1.2 base 自带冲突（boot 失败，适配点③）；`defineTool` 须补显式 `additionalProperties`（适配点①）；verifier 终判时序须复核 wrapup 行为（适配点②）。
- `agent/turn-stopping` 的 payload 形状按 `agent?.id` 防御式取值；llm stream chunk 的文本抽取兼容 `block.text / text / delta` 三种形状——两者均待真实 profile 冒烟确认。
- 事件载体为共享 KV unit（按 agentId 前缀隔离）；ledger 无 compaction，事件只增。
- L3 external-state verifier、L5 human、spec 编译器（苏格拉底澄清）为三阶段内容（原二阶段 Proof-Carrying，ADR-0012 后并入三阶段）；自适应 Loop 由 `@gungnir/agent-loop` 承担（二阶段 spike）。
