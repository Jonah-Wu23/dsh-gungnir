# DSH 接口事实手册（L2）

> 唯一的 DSH 接口事实权威。全部条目基于 **`@deepseek-ai/dsh@0.1.1-rc.2`**（全局安装于 `C:\Users\JonahWu\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`，2026-08-28 勘察）。
> 标注：〔CLI〕= 命令实测；〔README〕= 包 README 阅读；〔类型〕= lib 内 .d.ts 勘察；〔实现〕= dist/lib 内编译后 .js 实现勘察。上游仓库：`github.com/deepseek-ai/deepseek-harness`（monorepo，各包 README 从仓库相对路径引用）。
> **与实际行为不符时：以实测为准，回写本文件。**
> 2026-08-28 二次深勘（M0）：逐包 .d.ts + 编译后 JS 勘察，新增 §10–§14，并据实测结论回写 §4（OPEN-1 已有结论）、§5、§6。原始报告存档于 [dsh-interface-detail.md](dsh-interface-detail.md)（只读证据附录）。

## 1. CLI 与 Profile 机制〔CLI/README〕

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动 `$DSH_HOME/profiles/<name>` 下的 profile |
| `dsh web` | `--profile web` 别名（首次使用自动从模板初始化） |
| `dsh --profile headless "job"` | 单个全新持久会话，跑完打印最终答案并退出——集成冒烟主力 |
| `dsh plugin --profile <name> <pnpm args>` | 在 profile 目录转发 pnpm 管理插件（如 `add <pkg-or-path>`） |
| `dsh --profile <name> --dump-config` / `--dump-default-config` | 不启动打印组合后配置树——装载验证用 |

- 调用目录即默认 workspace 根。launcher flag 必须在前，第一个不认识的 token 起归 app 参数。
- profile 目录：`package.json`（树外依赖）+ `dsh.profile`（bundles 有序清单）+ `cordis.patch.yml`（用户层）。
- 配置树叠加顺序：空根 → bundles（按序，先从 dsh 安装目录解析，再从 profile node_modules）→ profile patch → home patch → `--patch`。**patch 替换整行 config，无深合并**。
- web/headless 自动初始化；其他 profile 必须经 `dsh plugin` 创建。

## 2. 插件开发模型〔README/类型/实现〕

- 插件 = Cordis 插件：ESM、`apply(ctx)`、显式 inject 声明、Schema 配置；服务/工具/监听注册到 `ctx`，效果随 scope 卸载。
- 官方插件包内使用 `@deepseek-ai/schemastery`（Schema）+ `zod`（运行时校验）。
- 参照实现：`dsh-goal`（域服务+durable 事件）、`dsh-command-goal`（人侧命令）、`dsh-tool-goal`（模型侧工具）、`dsh-tool-ralph`（编排策略插件——Gungnir 的定位参照物）。
- 包 README 文风：Contract / Composition / Events / Failure discipline / Known Limitations 小节——本仓库包 README 对齐此风格。
- **版本事实〔实现〕**：`@deepseek-ai/cordis` **4.0.1**（fork）；`@deepseek-ai/schemastery` **3.18.1**；所有 `@deepseek-ai/dsh-*` 包统一 `^0.1.1-rc.2`。
- **包级导出四件套〔类型：dsh-tool-ralph/lib/types/index.d.ts〕**：`name`（常量）、`inject: string[]`（服务键数组，如 `['tools','agents','goals','sessions']`）、`Config`（schemastery `z.object(...)`，可选）、`apply(ctx, config)`。Service 类形态（dsh-goal）：`class XService { static inject; static Config; constructor(ctx, config?) }`。
- **peerDependencies 模板〔实现：dsh-tool-ralph/package.json 原文〕**：只声明实际 inject 的包 + cordis，版本与上游一致：
  ```json
  "peerDependencies": {
    "@deepseek-ai/dsh-agent": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-tools": "^0.1.1-rc.2",
    "@deepseek-ai/cordis": "^4.0.1"
  }
  ```

## 3. 服务目录（ctx key）〔README 汇总〕

| key | 职责 |
|---|---|
| `agents` | AgentRegistry：register/get/list/roots、initiator scope、`assembleContextFor` |
| `agentLoop` | 具体循环驱动（`ctx.agentLoop.create(...)`）；唯一含 concrete loop 的包是 `dsh-agent-loop`——**禁止修改/替换** |
| `goals` | 事件溯源 goal 域（§6） |
| `tools` | 工具注册与执行管线（§4） |
| `workflowEngine` | 模型编排脚本执行（start→WorkflowRun） |
| `subagents` | 命名 provider 委派（start/startContinuable/followup/interrupt） |
| `sessions` | 持久会话（`flush()` 满足持久性义务） |
| `llm` | 模型调用（HarnessError 基类；rubric verifier 经此） |
| `commands` | 人侧全局命令（`/goal` 即此实现——`/ultragoal` 同构） |
| `skills` | skill provider 注册表 |
| `fs` | 受 fence 的文件服务（sandbox 策略下与 dsh-fs-local 互斥） |
| `userQuestions` | 人侧提问（`ask({questions, agent, signal})`；仅 runtime root agent 可问，子 agent 抛错）〔类型：dsh-user-questions〕 |
| `storage` | 插件本地持久化 hub（KvFacet，详见 §13）〔类型：dsh-storage〕 |

## 4. 事件词汇表〔类型〕

**Agent 域**（`dsh-agent`；scope-filtered，agent 级监听只收该 agent）：
`agent/created`、`agent/disposed`、`agent/session-start`、`agent/status`、`agent/error`、`agent/request`（模型路由 waterfall）、`agent/request-error`、`agent/turn-stopping`、**`agent/pre-step`**。

```ts
// 已验证签名（waterfall，可改写进入模型的消息）
'agent/pre-step'(payload: { agent, messages: UserMessage[], turn, step, signal },
                  next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
// PreStepDecision = { kind: 'reject' } | { kind: 'enter', messages: UserMessage[] }
```

**Tools 域**（`dsh-tools`；执行管线 = `tools/pre-execute`(允许/拒绝门) → 注册守卫 → `tools/execute`(around，超时/重试) → `tools/post-execute`(检查/替换/增强结果) → finalize → **`tools/result`**(observe-only 通知)）：
`tools/pre-execute`、`tools/execute`、`tools/post-execute`、`tools/result`（**两个位置参数** `(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>)`，emit——不是单 payload 对象）、`tools/change`、`tools/code-dispatch-log`。工具呈现模式：`native` / `code` / `both`（`tools.mode` 配置）。

```ts
// tools/result 字段事实〔类型：dsh-tools/lib/types/index.d.ts〕
ToolExecution:  { callId, rootCallId?, name, arguments /*深冻结*/, agent?, parent?, signal, token }
ToolExecutionSuccess: { isError: false, value: JsonValue, content: ContentBlock[], meta?, additionalContexts?, concludesTurn?: true }
ToolExecutionFailure: { isError: true, error: ToolFailure /* {message, info?:{name, code}} */, content: ContentBlock[], meta? }
// 注意：类型层【没有 exit code 字段】——退出码由各 shell 工具自行放入 content/meta；模型可见文本 = content 里的 TextBlock {type:'text', text}
```

**Session 域**（`dsh-session`）：`session/created`、`session/disposed`、`session/event`、`session/flush`、`session/end-seed`、`session/title`。durable 事件经 `agent.session.append(type, payload)` 写入；**session log 是唯一持久权威**（但可写事件类型受封闭白名单约束，见下）。

**Goal 域**：`goal/change`（durable 事件类型，全量 post-mutation 快照）+ `goal/changed`（live emit，含 operation/ref/goal）。

**Session 持久化白名单——OPEN-1 已验证，结论：自定义 `gungnir/*` durable 事件不可用〔实现〕**：

- `SessionEventMap` 类型层是开放 map（可经 module merging 合并新键，dsh-goal 即此先例），`Session.append<T extends SessionEventType>(type, data)` 运行时对未知 type **不校验、可写入**（数据仅做 lossless-JSON 校验）。
- 但持久化/恢复侧 `dsh-session-persistence` 的 `assertEventsSupported`（lib/index.js:1117，resume/restore 路径四处调用）按 **封闭 47 项白名单**（`known-event-types.js`）校验：白名单外且未标 `ignorable: true` 的事件类型 → **拒绝加载整个会话**（"refusing to interpret the log"）。
- `ignorable` 标记**无公开写入通道**（`Session.append` 信封只有 type/seq/time/data/surface 元数据，参数无法传入）。
- 白名单文档原文：*"Downstream (out-of-repo) plugin events are outside this list by construction; a registration surface for them is deferred until such a consumer exists."*
- **结论**：树外插件往 session log 写自定义 durable 事件 = 会话一旦落盘即无法 resume（写坏日志）。ledger 载体改走 `ctx.storage` 独立 KV（§13，备选方案转正，见 ADR-0006）。

**durable 事件读取/重放 API〔类型：dsh-session〕**：`session.events`（readonly 深冻结快照，seq 连续）、`session.seq`、`session.firstLiveSeq`（本进程 seed 边界）、`session.deriveMessages()`；事件流监听 `ctx.on('session/event', (session, event) => …)`（emit）；`ctx.sessions.get(id)/list()/flush(session)`。

**Workflow 域**（observe-only）：`workflow/start|end|phase|log|agent-start|agent-end`。

**System prompt**：`system-prompt/assemble`（监听器可替换 registry 贡献，返回即权威）；scoped prompt sections / tools / 变量注册经 `Agent.ctx`。

## 5. Agent API 要点〔类型/README〕

- `Agent`：`id`（=session.id）、`session`、`inbox`、`status: 'idle'|'running'`、`ctx`（agent 级 scoped context，注册物随 dispose 卸载）。
- 消息：`send` / `steer` / `followup` / **`inject(UserMessage)`**（为下一 pre-step 排队模型可见上下文，不唤醒 driver；运行中在最近 step 边界领取）。
- `cancel(cause, { keepInbox? })`；每条 UserMessage 恰带一个 MessageSource；`{kind:'user'}` 是 host 证明——插件必须传自己的 source，**不得冒充 human authority**。
- **插件消息构造〔类型：dsh-llm/lib/types/message.d.ts〕**：`createUserMessage({ content: [{type:'text', text}], source })`；插件 source 用内建 `{ kind:'plugin', plugin: <插件名>, form: 'instructions'|'catalog'|'notice'|'relay'|'recall'|… }`（`form:'notice'` 的 summary ≤120 字符），或仿 dsh-goal 经 `MessageSourceMap` module-merging 自有 kind（如 `{kind:'gungnir', …}`）。**`kind:'goal'` 是 goal-round-driver 的保留通道，插件不得复用**。
- **事件派发是 scope-filtered〔实现：dsh-scope〕**：根 ctx 注册的监听收全部 agent；`agent.ctx`（agent scope 子 ctx）注册的只收该 agent。
- 模型路由：`installModelSelection(agentCtx, selection)` 快照 provider/model/reasoning-effort 作用于一步；`agent/request` waterfall 可动态改路由。

## 6. Goal 域语义〔README/类型〕（Gungnir 的地基，语义细节多，全部要遵守）

- 同 session 至多一个 current goal；phases：`active/paused/blocked/complete`；动词 create/edit/pause/resume/complete/block/clear。
- **GoalService 精确 API〔类型：dsh-goal/lib/types/index.d.ts〕**（`ctx.goals`，inject `['agents']`，Config `{defaultMaxGoalRounds?: number}` 默认 **256**）：

```ts
get(agent): GoalView | undefined
disarm(agent): GoalView | undefined
create(agent, { objective, maxGoalRounds? }): GoalView
edit(agent, ref: GoalRef, request): GoalView
pause / resume / complete(agent, ref: GoalRef): GoalView
block(agent, ref: GoalRef, reason: { code /* lower-kebab-case */, message }): GoalView
clear(agent, ref: GoalRef): GoalRef
```

- 变更用 `GoalRef {id, revision}` CAS 栅栏拒绝过期写（stale 抛 `GOAL_STALE_REVISION`）；每次变更 append 完整快照的 `goal/change`；`disarm()` 只撤进程本地续轮授权（activation **绝不持久化**，resume 后默认 disarmed 需显式 resume/arm）。
- 所有 API 要求 agent 是 `ctx.agents` 里的精确 live 实例。
- live 事件：`ctx.on('goal/changed', ({agent, change: {operation, ref, goal?}}) => …)`（emit，scope-filtered）。
- strict replay 只认 `goal/change`，拒绝畸形/断续 revision/非法转换；增量 replay 停在首个坏事件。
- **goal-round-driver**（详见 §13）：agent idle + armed + 有余量时，先 checkpoint（await `ctx.sessions.flush()`）再预约 `roundsStarted+1`，排一条 `<goal_round>` prompt（GoalMessageSource）；只有被承认的 goal-sourced `user/message` 推进 roundsStarted；人类消息不占轮次上限；混合批次中人类工作优先。空转风险：idle 不区分"等外部事件"与"该继续推理"（Gungnir 的 WAITING_EXTERNAL 动机，见 UltraGoal 文档引 discussion #4664）。
- **tool-goal**（模型侧）：`get_goal` / `create_goal(objective, max_goal_rounds?)` / `update_goal(goal_id, revision, action, ...)`。create/edit/pause/resume 需当前 turn 有被接受的 `{kind:'user'}` 消息或 steering；**complete/blocked 额外接受当前 goal round 身份**（goal-sourced user/message 的 id/revision/round 匹配）；goal-round 内的 blocked 连续轮数未达阈值会被机械拒绝；自主 complete/blocked 成功执行会 `concludeTurn()`。

## 7. Workflow / Subagent / Ralph 要点〔README〕

- `WorkflowStartRequest { meta, script, args?, subagentProvider?, maxTotalAgents?, parent, signal? }` → `WorkflowRun { id, meta, result, cancel, dispose }`；`WorkflowResult { value, stopReason, error?, agentsStarted }`；run 是 holder-owned，必须 dispose。
- subagent provider 需声明能力（如 structured output、`inheritsParentContext:false`）；`startContinuable` 建立可续 child。
- ralph = 固定前台 workflow（每轮 fresh child + 结构化 handoff：continue/complete/blocked + evidence），普通插件实现，不加 Ralph mode——**Gungnir 编排策略的官方范本**。

## 8. Windows 平台事实〔README/CLI〕

- 开发机 win32：pwsh 栈挂载（`pwsh-sandbox`/`tool-pwsh`），bash 栈禁用（同 patch 文件按平台互斥）；sandbox 走 Windows ACL restricted-token（`workspace-write` 限 workspace + 会话私有 temp 子目录）。
- ExitCode verifier 的命令一律按 pwsh 语义声明与测试。

## 9. 命令 API（dsh-commands）〔类型〕

```ts
ctx.commands.register(definition: CommandDefinition): () => void
interface CommandDefinition { name /* 无斜杠小写 */; description; input?: { hint: string; images?: boolean }; recordInput?: boolean;
  handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult> }
interface CommandInvocation { commandId; agent: Agent; rawInput /* 斜杠名之后的原文，含空白 */; attachments; signal }
type CommandResult = { kind: 'success'; text?: string; sourceEventSeq?: number } | { kind: 'error'; text: string }
```

- objective 参数取 `invocation.rawInput`；起 turn 用 `invocation.agent.followup(createUserMessage(...))`（排队并唤醒）；问人用 `ctx.userQuestions.ask({questions, agent, signal})`（仅 root agent）。
- `/goal` 即此实现，`/ultragoal` 同构。

## 10. 工具注册 API（dsh-tools `defineTool`）〔类型/实现〕

```ts
ctx.tools.register(defineTool({ name, description, parameters, output, timeoutMs?, execute }))
parameters: { [key]: { type: 'string'|'number'|'boolean'|…, required?: true, description } }   // 声明式 DSL，execute 收已校验 args
output: { schema: {...}, render(args, value): ContentBlock[] }   // 模型可见内容由 render 从返回值投影；execute 返回 canonical JSON 值
execute(args, exec: ToolRunContext /* 含 deferContext(UserMessage)、concludeTurn() */)
```

参照：dsh-tool-ralph `lib/index.js:300`（name/description/parameters/output.render/execute 全套真实写法）。

## 11. LLM API（dsh-llm）〔类型〕

```ts
ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>   // 唯一调用入口，自行拼装 chunk
GenerateOptions: { provider, model, reasoningEffort?, messages, system?, tools?, temperature?, maxTokens?, stop?, signal?, sessionId?, purpose? }
```

- **无原生 structured output**（无 response_format/json_schema 字段）：结构化输出需 prompt 约定 + 自行解析校验（zod），或走 workflow/subagent seam。

## 12. Storage API（dsh-storage / dsh-storage-json）〔类型/实现〕——ledger 载体

```ts
ctx.storage.backend  // BackendRegistry；内置 backend 注册名 "json"（dsh-storage-json lib/index.js:288）
ctx.storage.form(kind) / mount(kind, facility)
KvFacet.open(descriptor: { name /* 须匹配 UNIT_NAME_RE */; version /* 首次物化盖章，不匹配 → 'version-mismatch' */;
  tables: readonly string[]; hasGlobal: boolean }): Promise<KvUnit>
KvUnit: loadAll() / putRecord(table, key, value) / deleteRecord(table, key) / setGlobal(value) / close()
```

- 插件本地持久化的正规通道：每记录 KV + 全局值，version 戳防 schema 漂移。**Gungnir ledger 采用此通道**（见 ADR-0006）。

## 13. goal-round-driver 事实（dsh-goal-round-driver）〔类型/实现〕

- `inject = ['agents','goals','sessions']`；`apply(ctx)` **零配置**——轮数上限来自 goal 域：`create` 的 `maxGoalRounds` 或 `dsh-goal` Config `defaultMaxGoalRounds`（默认 256）。**不存在 `max_goal_rounds` 键名**。
- 自身 pre-step 监听（lib/index.js:281）：**仅当消息中存在 `source.kind === 'goal'` 且 `round > 0` 的 goal 源消息才介入**（校验 reservation，失败 `{kind:'reject'}`）；否则 `return next()` 透传。
- waterfall 组合顺序 = 监听注册顺序（先注册者在外层），最终顺序取决于 harness 配置的插件加载顺序。
- **共存规则（对 Gungnir 的硬约束）**：Gungnir 的 pre-step 监听器**不得丢弃 goal 源消息**——`{kind:'enter'}` 替换整批 messages 时必须保留队列中的 goal 源消息（否则驱动下一轮按 message id 做 stale 检查会拒）；Gungnir 指令消息用 `kind:'plugin'` source 追加，不复用 `kind:'goal'`。

## 14. 接缝回归清单（DSH 升级时必跑）

1. `dsh plugin --profile gungnir-dev` 安装本地插件 + `--dump-config` 确认装载。
2. headless 冒烟：一轮 `/ultragoal` 全链路（spec→round→evidence→verdict→status）。
3. `agent/pre-step` 签名与 goal-round-driver 共存顺序（OPEN-2 断言脚本）。
4. ~~自定义 `gungnir/*` durable 事件 append + 冷重建（OPEN-1 断言脚本）~~ **已验证并关闭（2026-08-28）**：自定义事件类型会被 persistence 白名单拒绝、无法 resume（§4）；ledger 走 ctx.storage。升级 DSH 时复验 assertEventsSupported 行为是否变化。
5. `tools/result` payload 形状（两位置参数、无 exit code 字段）；`ctx.goals` 动词与 CAS 语义；`tool-goal` authority 规则未变。
6. 破坏矩阵 D-1/D-4（kill 进程 / resume 重建）。
