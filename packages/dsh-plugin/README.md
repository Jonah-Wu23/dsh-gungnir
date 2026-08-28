# dsh-gungnir

> Declare it. Gungnir never misses.

Gungnir 的 DSH 适配层：把 `@gungnir/core` 的证据驱动 reconcile 循环接进 DeepSeek Harness 的树外 cordis 插件。基于 `@deepseek-ai/dsh@0.1.1-rc.2` 接缝实测（见 `docs/context/dsh-interface.md`）。

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

- 不修改/替换 `agent-loop` 与任何 DSH 核心包；不 fork。
- 不代模型调用 `update_goal`（complete/blocked 都由模型在 goal round 内自行调用）；不冒充 human authority。
- 不提供 `propose_loop_transition`（三阶段）；不管理多 goal / 跨 session goal。
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

- **ExitCodeVerifier 未接线**：harness 命令执行器接缝留待 M4 实测（沙箱 authority 边界，不私开进程）；当前 `runCommand` 一律抛错 → L1 verdict 为 INCONCLUSIVE。一阶段的可完成目标请用 artifact 谓词（或 L4 + L1/L2 组合会在阶梯规则下受阻）。
- `ctx.storage` KvFacet 的解析按多路径尝试（`backend.get/resolve/open("json")`、`storage.kv`），均失败则加载失败——KvUnit 打开协议在 0.1.1-rc.2 上未实测。
- `agent/turn-stopping` 的 payload 形状按 `agent?.id` 防御式取值；llm stream chunk 的文本抽取兼容 `block.text / text / delta` 三种形状——两者均待真实 profile 冒烟确认。
- 事件载体为共享 KV unit（按 agentId 前缀隔离）；ledger 无 compaction，事件只增。
- L3 external-state verifier、spec 编译器（苏格拉底澄清）、自适应 Loop 均为后续阶段。
