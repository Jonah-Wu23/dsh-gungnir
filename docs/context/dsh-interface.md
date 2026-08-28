# DSH 接口事实手册（L2）

> 唯一的 DSH 接口事实权威。当前基线：**v0.1.2-alpha.1 源码构建**（2026-08-28 工作块 8 起；源码树 `deepseek-harness-dsh-v0.1.2-alpha.1/`，全局 `dsh` 经 `tools/dsh-shim/` 转发到 `apps/cli/lib/bin.js`；基线切换决策见 ADR-0011）。
> §1–§14 条目实测于 `@deepseek-ai/dsh@0.1.1-rc.2`（原全局 npm 安装，2026-08-28 勘察），§15 逐项复核后与 0.1.1 的差异已标注；**两版冲突处以 v0.1.2 为准**，0.1.1 实测记录保留作回归对照。
> 标注：〔CLI〕= 命令实测；〔README〕= 包 README 阅读；〔类型〕= lib 内 .d.ts 勘察；〔实现〕= dist/lib 内编译后 .js 实现勘察；〔v0.1.2 实测〕= 源码构建运行时验证。上游仓库：`github.com/deepseek-ai/deepseek-harness`（monorepo，各包 README 从仓库相对路径引用）。
> **与实际行为不符时：以实测为准，回写本文件。**
> 2026-08-28 二次深勘（M0）：逐包 .d.ts + 编译后 JS 勘察，新增 §10–§14，并据实测结论回写 §4（OPEN-1 已有结论）、§5、§6。原始报告存档于 [dsh-interface-detail.md](dsh-interface-detail.md)（只读证据附录，0.1.1-rc.2 语境）。
> 2026-08-28 v0.1.2-alpha.1 源码勘察见 §15（原"增量"节，基线切换后转正：凡 §15 与 §1–§14 冲突，以 §15 为准）。

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
- **版本事实〔实现〕**：`@deepseek-ai/cordis` **4.0.1**（fork）；`@deepseek-ai/schemastery` **3.18.1**；`@deepseek-ai/dsh-*` 包：0.1.1 系统一 `^0.1.1-rc.2`，**v0.1.2 起统一 `0.1.2-alpha.1`**（源码树各包 version 一致；npm 未发布，仓内对齐走 `link:` 指向本地源码树，ADR-0011）。
- **包级导出四件套〔类型：dsh-tool-ralph/lib/types/index.d.ts〕**：`name`（常量）、`inject: string[]`（服务键数组，如 `['tools','agents','goals','sessions']`）、`Config`（schemastery `z.object(...)`，可选）、`apply(ctx, config)`。Service 类形态（dsh-goal）：`class XService { static inject; static Config; constructor(ctx, config?) }`。
- **peerDependencies 模板〔实现：dsh-tool-ralph/package.json 原文〕**：只声明实际 inject 的包 + cordis，版本与上游一致：
  ```json
  "peerDependencies": {
    "@deepseek-ai/dsh-agent": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-tools": "^0.1.1-rc.2",
    "@deepseek-ai/cordis": "^4.0.1"
  }
  ```
- **bundle 入层机制〔CLI/实现实测 2026-08-28 工作块 3〕**：树外插件 package.json 声明 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` 后，`dsh plugin add` 的 reconcile 会自动把它加进 profile 的 `dsh.profile.bundles` 层栈；无此声明只是普通依赖、不激活（CLI 有一次性警告）。patch 文件为 insert 行式：`- insert: [{id, name, config?, disabled?}]`，`config` 行内支持 `!!js` 表达式（dsh-base 用 `dshHomePath('...')` 与 `process.env.*`）。
- **inject 强制〔boot 实测〕**：cordis 运行时对未在插件 `inject` 数组声明的 ctx 服务键访问直接抛 `cannot get property "<key>" without inject`——按需访问的服务也必须全部声明（Gungnir 声明 7 个）。
- **dsh-storage 挂载〔boot 实测〕**：dsh-base 不含 storage 行；挂 `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` 需自备 config `root`（缺省抛 `$.root missing required value`），实测 `root: !!js dshHomePath('storage')` 可用。

## 3. 服务目录（ctx key）〔README 汇总〕

| key | 职责 |
|---|---|
| `agents` | AgentRegistry：register/get/list/roots、initiator scope、`assembleContextFor` |
| `agentLoop` | 具体循环驱动（`ctx.agentLoop.create(...)`）；唯一含 concrete loop 的包是 `dsh-agent-loop`——**官方架构明示可从配置替换**（源码树 `docs/architecture.md:11,59`：agent loop 与其他部件一样是插件、可从配置替换；`docs/capability-seams.md:507`：扩展包依赖 dsh-agent 事件与服务，不依赖本包；`apps/cli/composition.md:270`：agent-loop 是 bundles 清单的一行）。Gungnir 的 Adaptive Loop Runtime 即替换实现（ADR-0012）；树外 loop 包进 bundles 层栈的确切机制 = **OPEN-7**（二阶段 M0 实证） |
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

### 8.1 `ctx.shell` 与 sandbox 实测事实〔实测 · 2026-08-28 · DSH `0.1.1-rc.2`〕

> 工作块 4 的 L1 接线是按 `.d.ts` 写的；本节为工作块 5 在**真实 profile 上真跑**后的回写，与类型声明不一致处以本节为准。

**调用面**（插件侧 inject 需显式声明 `'shell'`，缺则 cordis 拒绝装载）：

```ts
ctx.shell.resolve({ command, timeoutMs }) => ShellExecSpec
await ctx.shell.run(spec)                => Promise<ShellRunResult>
```

**`ShellRunResult` 实测形状**（与类型声明一致，可放心取值）：

| 字段 | 实测 |
|---|---|
| `exitCode` | 数值；成功与被拒都有值。无值仅出现在被 signal 终止/启动失败 —— 插件侧折叠为 `exitCode=1` 并保留 stderr（loud fail，不伪造成功） |
| `stdout` / `stderr` | `CollectedOutput { text, truncated, spillPath? }`，取 `.text` |
| `signal` / `timedOut` / `aborted` | 终止类信号，按实测存在 |
| `sandbox` | 可选；`{ mode, denied, enforcement, runnerFailed }` |

**sandbox 语义实测**（`dsh-sandbox-policy`，win32 下 `dsh-pwsh-sandbox`，`mode: workspace-write`，由 `DSH_PERMISSION_MODE` 驱动）：

| 命令 | 实测结果 |
|---|---|
| 写文件到工作区内（如 `out/probe-ok.txt`） | `exitCode=0` → L1 PASS，文件确实落盘 |
| 写文件到工作区外（如 `C:\Users\...\probe-out.txt`） | `exitCode=1`、`sandbox.denied=true` → L1 FAIL，**目标文件从未被创建** |

- **验证方式**：`dsh --profile headless` 真跑两条 `Write-Content` 命令（区内 / 区外），跑完后分别 `Test-Path` 复核存在性（区内 PRESENT、区外 NOT_PRESENT）。
- **结论**：sandbox authority 仍归原 owner，Gungnir 未绕过、也未削弱；L1 判定的"退出码证据"因此是可信的世界观测。
- **插件侧处理原则**（Let It Fail）：`sandbox.denied` / `sandbox.runnerFailed` 表示**策略拒绝或执行器故障**，不是"命令本身失败" —— 一律**抛错让 verifier 落到 INCONCLUSIVE**，绝不折叠成普通 exitCode 掩盖真故障。
 pwsh 语义声明与测试。

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
7. 三个 `gungnir_*` 工具的 parameters/output 内全部 object schema 显式声明 `additionalProperties`（§15 适配点①；v0.1.2 现役强制）。
8. complete/blocked 时序复核：verifier 终判与 GOAL_REVALIDATION 不在 `<goal_complete>`/`<goal_blocked>` wrapup 落盘前抢跑（§15 适配点②；v0.1.2 现役行为）。
9. 插件 patch 不得再 insert `storage`/`storage-json` 行——v0.1.2 base 自带（§15 适配点⑥，重复 id 直接 boot 失败）；升级时复核 base bundle 层栈变化。
10. loop 替换 seam 复验（OPEN-7 实证后转正）：bundles 清单中 agent-loop 行的可替换性、`ctx.agentLoop` 服务键形状、替代 driver 对 agent 生命周期/turn-step 边界/工具调度/teardown 职责的完整承担。**已实证并转正（2026-08-29，OPEN-7 关闭）**：机制与职责清单见 §16。

## 15. v0.1.2-alpha.1 基线事实（2026-08-28 源码勘察；2026-08-28 工作块 8 起为开发基线）

> 对象：仓库根 `deepseek-harness-dsh-v0.1.2-alpha.1/` 源码树（src/ TypeScript），已构建并设为开发基线（安装方式与冒烟结论见 ADR-0011）。标注〔v0.1.2 实测〕的条目经过该构建的运行时验证，其余为源码级结论。与 §1–§14（0.1.1-rc.2 实测）冲突时以本节为准。

**白名单与持久化**〔源码〕：

- `KNOWN_SESSION_EVENT_TYPES` 仍封闭且条目有增（新增 `model/selection`、`session-log-deepseek/delivery-accepted`、`subagent/model-selection-policy`），不含 `gungnir/*`；`ignorable` 标记从信封校验中移除；仍无树外插件注册通道。`packages/core/session/src/known-event-types.ts:18-70`、`packages/session/session-persistence/src/coordinator.ts:1139-1143`。→ ADR-0006 维持。
- `SESSION_FORMAT_VERSION` 仍为 0，无兼容性承诺（`packages/core/session/src/types.ts:56`）。
- 磁盘格式新增 `sourceEventSeqs` 区间编码（`packages/core/session/src/seq-ranges.ts:15-26`）——直接解析原始 JSONL 字节需先 `decodeSeqRanges`；经 `session.events` API 读取不受影响。
- torn-tail 自动修复输出 warn 并注明会话（`packages/session/session-persistence-jsonl/src/index.ts:459`）——破坏测试 resume 见此 warn 属预期恢复行为，勿判失败。

**稳定接缝（源码确认与 §3–§13 记录一致）**：`agent/pre-step` waterfall（`PreStepDecision` 新增可选 `startsRequestSeries?: true`，插件无需设置）；`tools/result` 两位置参数 observe-only；`ctx.goals` 全套 + GoalRef CAS + `defaultMaxGoalRounds` 256 + disarm 语义；goal-round-driver 续轮（pre-step 仍只拦 `kind:'goal'` 且 `round>0`；**idle 空转仍无上游处理**，WAITING_EXTERNAL 动机不变）；`ctx.commands.register`；`ctx.userQuestions.ask`（仍仅 root agent，子 agent 抛 `CALLER_NOT_LIVE`/`DELEGATED_CALLER`）；`ctx.shell` resolve/run（`exitCode` 类型诚实化为 `number|null`；管道空输出修复在共享 subprocess 层，Windows pwsh 亦受益）；`ctx.llm.stream`（GenerateOptions 不变，仍无原生 structured output）；`installModelSelection`/`agent/request` waterfall；`ctx.storage`（KvFacet 增可选 `layout?: 'single'|'per-record'`，默认行为不变）；`dsh plugin --profile add` + `dsh.bundle.patch` 入层机制；`dsh --profile headless` / `--dump-config` CLI；headless stderr 进度 / stdout 结果分流（0.1.1 已是此语义，changelog 该条目不构成行为变化）。

**破坏性/适配点**〔源码〕：

1. `defineTool` 的 object schema 强制显式 `additionalProperties: boolean`，缺省注册时抛 `JsonSchemaError`（`packages/core/tools/src/schema.ts:68-72, 366-369`）。→ 二阶段 M0 核对 `gungnir_submit_spec` / `gungnir_plan` / `gungnir_report` 全部 object schema。
2. tool-goal 自主 complete/blocked 不再 `concludeTurn()` 硬停 turn，改为 `deferContext` 注入 `<goal_complete>`/`<goal_blocked>` wrapup（`packages/goal/tool-goal/src/wrapup.ts:9-16`、`index.ts:313-326`）。→ verifier 终判与 REVALIDATION 触发必须等 wrapup 落盘，升级时在真实 profile 复核时序。
3. 事件改名：`tools/code-dispatch-log` → `tools/ptc-dispatch-log`（Gungnir 未监听，无影响）。
4. 仓库布局重组为 `packages/<group>/<pkg>/`；包名不变，版本统一 `0.1.2-alpha.1`；`@deepseek-ai/cordis` 仍 4.0.1。
5. `Minimal` agent preset 不挂载 `dsh-command-goal`（故无 `/goal`）——命令可见性由 preset composition 决定（`packages/preset/agent-presets/presets/minimal/agent.cordis.yml`）。→ `/ultragoal` 仅在挂载了 Gungnir 的 preset/composition 中可用，包 README 需写明。
6. base bundle 自带 storage 栈〔v0.1.2 实测，boot 证据〕：`packages/bundle/base/cordis.patch.yml:141-156` 挂载 `storage` + `storage-json`（root `dshHomePath('storages')`）+ `storage-domain`（backend json）。树外插件再 insert 同 id 行 → `duplicate loader entry id: storage`，boot 失败（0.1.1 时"dsh-base 不含 storage 行"作废）。→ 插件 patch 不得重复挂载 storage，直接 inject 宿主服务；注意 ledger 数据根目录随之迁到 `storages/`。

**新能力**〔源码〕：

1. 子代理模型选择：`SubagentStartRequest.agentOptions: {provider, model, reasoningEffort, maxTokens}`（`packages/core/agent/src/runtime-types.ts:25-34`）；host 授权开关 `subagent-model-selection`（`packages/subagent/tool-subagent/src/model-selection-settings.ts:19-34`）；工具实例需 `modelSelectionSettings: true` 方暴露给模型。→ 三阶段 model 轴的委派路径。
2. 插件可注册可配置 LLM 提供方与模型发现：`ctx.llm.registerConfigurableProviders(...)` / `registerModelDiscovery(...)`（`packages/llm/llm/src/index.ts:474-527, 548-568`）。→ 四阶段可选。
3. 公网 WebFetch 默认启用 + SSRF 防护：非公网地址抛 `WEB_BLOCKED_URL`（`packages/web/web-fetch-http/src/network.ts:53-109`）；插件侧通道 `ctx.web.fetch()`。→ 二阶段 L3 external-state verifier 的公网核验通道；localhost/内网目标不可用此路径。
4. 遥测默认状态：插件包名/版本随 DeepSeek 请求上报默认开（`dsh-plugin-package-inventory-deepseek`）；session log 增量上传默认关（`dsh-session-log-deepseek`）；`DSH_TELEMETRY_DISABLED=1` 硬关（`apps/cli/src/profile-boot.ts:90-103`）。→ dev/实验 profile 统一硬关。
5. compaction 新增 `toolResultPruner` 与图片计价（`packages/compaction/compaction-tool-result-pruner/src/index.ts:44-185`）；事件 log 仍 append-only 完整，surface 会被改写——evidence 的事件级 locator（turn/step/callId）不受影响。

## 16. loop 替换 seam 与替代 driver 职责清单（OPEN-7，2026-08-29 实证关闭；v0.1.2-alpha.1 实测）

> 本节是 ADR-0012/ADR-0014 的机制事实权威。全部条目经过真实 profile 运行时验证
> （`gungnir-loop` spike profile + 真实模型 headless 全链路），实证方法随条目标注。

### 16.1 替换机制〔v0.1.2 实测〕

- **bundle patch 合并算法**（`@deepseek-ai/cordis-plugin-include` lib/index.js `applyEntryPatches`）：所有层的 patch 按序应用到 profile 根 entry 数组。**非 insert patch 按 id 原位修改现有行**，其中 `name` 字段是匹配前置条件（不匹配则 warn 并跳过整条 patch），**不是覆盖值**——即 patch 无法改写一行的包名。`insert`（无 id）向根数组追加行；多行 insert 后同 id 会在 loader 的 `EntryGroup.update` 抛 `duplicate loader entry id`（同 group config 内不允许重复 id）。
- **替换两步法**（已实证）：
  1. `- id: agent-loop` + `disabled: true`——按 id 命中 base bundle 插入的默认 driver 行并停用；
  2. `- insert: [{id: gungnir-loop, name: <自研包>, config: …}]`——追加自研 driver 行。
- **服务键不变**：自研 service 构造时 `super(ctx, 'agentLoop')`（cordis Service 名），并 `ctx.agents.setFactory(this)`。headless/ACP/subagent 等消费方全部经 `ctx.agents.create/resume`（AgentRegistry → factory），**不直接 import 默认 driver 包**，因此替换对它们透明。
- `--dump-config` 验证：`gungnir-loop` profile 输出中 `agent-loop` 行带 `disabled: true`、自研行就位、无 duplicate 错误；真实 boot + headless 任务由 AdaptiveLoopAgent 完成（`gungnir` 插件的 pre-step 监听与 `ctx.tokenMeter` 均在该 session 上工作）。
- **单实例纪律（M1 硬前置，实测教训）**：树外包与宿主必须解析到**同一份** `@deepseek-ai/*` 模块。DSH 的 `TOOL_RUNTIME_SCHEDULER` 等关键符号线是 `Symbol(...)`（非 `Symbol.for`），双副本 = 符号不相等 = scheduler 不可达。仓库侧已把 `packages/dsh-plugin`、`packages/agent-loop` 的 node_modules 以 junction 指向 v0.1.2 源码树（含 `vendor/cordis`、`vendor/schemastery`），peerDeps 锁 `0.1.2-alpha.1`（ADR-0011 第 3 条落地）。

### 16.2 替代 driver 职责清单（spike 期逐条对照 `dsh-agent-loop` 源码整理；Gungnir driver 全部承担）

1. **Agent 生命周期**：`AgentFactory`（`createAgent`/`resume`）+ registry `setFactory`；configured agents 启动路径（sessionId/resumeSessionId/restoreOrCreate）；ownership 反卷（factory dispose → 活跃 agent cancel + whenIdle + scope dispose → registry/session detach → owner effect 释放），memoized 防并发双拆。
2. **turn/step 边界**：`turn/start` → `step/start` → `user/message`（append）→ … → `step/end` → `turn/end(reason)` 全序列；max-tokens sticky；reject 决策 → `blocked`；wake latching（maintenance/aborted 场景）。
3. **pre-step 管线**：inbox claim → `systemPrompt.assemble(assembleContextFor(agent, signal))` → runtime-context 投影（`@deepseek-ai/dsh-system-prompt` 源的 snapshot 消息）→ `agent/pre-step` waterfall（`{kind:'enter', messages}`）。
4. **请求构造**：`agent/request` waterfall → `prepareCall` adapterDefaults → `canonicalHeader` + `request/header`（initial/resume/change/series 四种 reason）→ `request/context` → `markAgentLoopRequest(deepFreeze(...))`。
5. **LLM 流**：`ctx.llm.stream` / `preparedCall.stream`；`BlockAssembler` 聚合；`assistant/chunk`（逐 chunk 落盘）→ `assistant/message`（`sourceEventSeqs` 指回 chunk 区间）；usage；abort 时 interrupted blocks 落盘；`agent/request-error` waterfall 的 retry 协议。
6. **工具调度**：`ctx.tools.executionMode` 分类；exclusive 屏障 + 有界并行池（`maxParallelToolCalls`）；registry 变更后重分类；model-order commit；`tool/call` → `tool/result`（`sourceEventSeqs: [callSeq]`）；`additionalContexts` 注入 next-step inbox；`concludesTurn`；abort drain（未启动调用补 `TOOL_ABORTED_BEFORE_DISPATCH` 合成结果，保持 replay 有效）；scheduler 内部故障不伪造结果、fail loud。
7. **取消语义**：`cancel(cause, {keepInbox})`；`agent/status`（idle⇄running）；`agent/error` 边界上报；`runMaintenance` 独占窗口；disposed 取消不 latch。
8. **resume/fork**：persistence `prepare` 载入；Inbox 从 `agent/inbox/spliced` 重放重建；`request/header` 带 `reason: 'resume'` 锚；fork seed 经 `CreateAgentOptions.seed`。
9. **系统提示面**：`renderPrompt` + `renderContextSections` + `joinContextSections`；prompt 变量（provider/model/cwd）由 loop 服务注册。

### 16.3 token-meter 插件侧可达性（OPEN-5，v0.1.2 实测关闭）

- base bundle 自带 `token-meter` 行（`packages/bundle/base/cordis.patch.yml:323-324`）→ 凡 base-backed profile 均有 `ctx.tokenMeter`，插件可安全 inject（Gungnir 插件已声明并实测）。
- `ctx.tokenMeter.measure(session, requestHeader?)` → `TokenMeasurement { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens, nodes }`；`baseline.kind === 'usage'` 时携带 provider 实报（`inputTokens` / `outputTokens` / `cacheReadTokens`），是精确 token 口径；无 usage 锚时退启发式估计。
- 实测（真实 headless，gungnir 插件轮末调用）：`total=18886 surface=5068 baseline={kind:'usage', usage:{inputTokens:13829, outputTokens:16, cacheReadTokens:2816}}`。**M2/M3 的 token 指标以 usage 锚点为准**，启发式仅作退路。

### 16.4 tool-goal wrapup 时序（适配点②，v0.1.2 实测）

- 机制：`update_goal(complete/blocked)` 在 goal-round 权限下不再 `concludeTurn()`，改为 `deferContext` 注入 `<goal_complete>`/`<goal_blocked>` wrapup 消息（`packages/goal/tool-goal/src/wrapup.ts`）；wrapup 作为下一步输入进 turn，模型写收尾消息后 turn 才结束。
- 与 Gungnir 的时序契约：Gungnir 的轮末 reconcile 触发点只有两个——`gungnir_report` 工具内（报告即轮末）与 `agent/turn-stopping`（兜底）。二者都不可能在 update_goal 与 wrapup 落盘之间抢跑：update_goal 所在 step 以 null 结束（无 concludeTurn）→ turn 继续到 wrapup step；turn-stopping 只在 wrapup step 收口后触发。
- 实测：真实 headless 全链路（spec→REVALIDATION→COMPLETE→update_goal→收尾→turn/end completed）两次通过，session log 事件序与上述一致，无 goal/changed 相位失配告警。goal-round 权限路径（round>0 turn 内 complete → wrapup 注入）由确定性探针补验（M1 测试基建，同 D-13 resume 场景）。
