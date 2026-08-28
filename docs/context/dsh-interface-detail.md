# DSH 接缝勘察原始报告（证据附录，L3）

> **性质**：2026-08-28 M0 接缝深勘的子代理原始输出——逐包 .d.ts + 编译后 JS 勘察，对象 `@deepseek-ai/dsh@0.1.1-rc.2`（全局安装于 `C:\Users\JonahWu\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`）。
> **地位**：仅作 [dsh-interface.md](dsh-interface.md) 的证据附录（L3 深层）。结论与规范的**唯一权威家是 dsh-interface.md**；本文件是存档，**只读不更新**——新事实或勘误一律回写 dsh-interface.md。
> **使用方式**：只在 dsh-interface.md 的条目被质疑、或需要核对原文类型签名与行号时查阅。发现与本机实际安装行为不符时，以重新实测为准并更新 dsh-interface.md（附验证方式与版本号）。

---

（以下为原始报告，未删改。所有相对路径均相对于 DSH 安装目录，下称 `<dsh>`。）

---

## 1. 包清单

【包名】`@deepseek-ai/dsh` v0.1.1-rc.2；其依赖全部在 `<dsh>/node_modules/@deepseek-ai/` 下独立可 import（每个包都有 `exports` map 与 `.d.ts`）。

【文件路径】`<dsh>/package.json`；`<dsh>/node_modules/@deepseek-ai/`（约 170 个 @deepseek-ai 包）。

关键版本事实（逐一 grep 自各 package.json）：
- `@deepseek-ai/cordis` **4.0.1**（cordis 官方 fork，`Context/Service/Events` 同构）
- `@deepseek-ai/schemastery` **3.18.1**（`z` 的一元类型 `z<T>`）
- 所有 `dsh-*` 包统一 **`^0.1.1-rc.2`**（dsh 主 package.json 的 dependency 写法）
- 插件基建：`@deepseek-ai/cordis-plugin-loader` ^1.0.2、`cordis-plugin-include` ^1.0.6、`cordis-plugin-hmr` ^1.0.16、`cordis-plugin-timer` ^1.1.3

与你的插件相关的可 import 包（实测存在且有 types）：`dsh-agent`、`dsh-session`、`dsh-session-persistence`、`dsh-tools`、`dsh-commands`、`dsh-goal`、`dsh-goal-round-driver`、`dsh-llm`、`dsh-user-questions`、`dsh-storage`、`dsh-storage-json`、`dsh-scope`、`dsh-system-prompt`、`dsh-brand`、`dsh-invariants`、`dsh-attachment`。

`dsh-tool-ralph/package.json` 的 peerDependencies 原文（可直接照抄此风格）：
```json
"peerDependencies": {
    "@deepseek-ai/dsh-invariants": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-llm": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-system-prompt": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-subagent": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-agent": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-workflow": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-tools": "^0.1.1-rc.2",
    "@deepseek-ai/cordis": "^4.0.1"
}
```

【结论】peerDependencies 应写：`@deepseek-ai/cordis: ^4.0.1` + 你实际注入的每个 `@deepseek-ai/dsh-*` 包 `^0.1.1-rc.2`（+ `@deepseek-ai/schemastery: ^3.18.1` 若声明 Config），版本写法与仓库插件完全一致。

---

## 2. 插件入口形态

【包名】`@deepseek-ai/dsh-tool-ralph`（函数式插件参照）；`@deepseek-ai/dsh-goal`（Service 类插件参照）

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-tool-ralph/lib/types/index.d.ts`（实现 `lib/index.js`）；`<dsh>/node_modules/@deepseek-ai/dsh-goal/lib/types/index.d.ts`

原文摘录（tool-ralph，函数式）：
```ts
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "tool-ralph";
export declare const inject: string[];
export interface Config {
    subagentProvider?: string;
    maxRounds?: number;
    maxHandoffChars?: number;
    maxResultChars?: number;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
```
实现里的 `inject` 与 Config 实例（`lib/index.js`）：
```js
const inject = ["tools", "workflowEngine", "subagents", "systemPrompt"];
const Config = z.object({
    subagentProvider: z.string().default("spawn"),
    maxRounds: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(256), ...
});
```
Service 类形态（dsh-goal `GoalService`）：
```ts
export declare class GoalService extends TypertRemoteService {
    static inject: string[];        // 运行时 = ['agents']
    static Config: z<Config>;       // z.object({ defaultMaxGoalRounds: z.number().default(256) })
    constructor(ctx: Context, config?: Config);
```

【结论】包级导出四件套 `name` / `inject`(服务键字符串数组，如 `['tools','agents','goals','sessions']`) / `Config`(schemastery `z.object`) / `apply(ctx, config)`，或者导出一个带 `static inject` + `static Config` 的 Service 类由 `ctx.plugin` 挂载。

---

## 3. session durable 事件

【包名】`@deepseek-ai/dsh-session`

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts`（Session 类）、`.../lib/types/types.d.ts`（SessionEventMap）、`.../lib/types/known-event-types.d.ts`(+`.js`)；执行拒绝点在 `<dsh>/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js:1117`

append 确切签名（index.d.ts:212）：
```ts
append<T extends SessionEventType>(type: T, data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []): SessionEvent<T>;
```
事件词汇表是**开放 map**（types.d.ts:360-361）：
```ts
/** The appendable event-type keys of {@link SessionEventMap}, plugin-merged extensions included. */
export type SessionEventType = keyof SessionEventMap;
```
插件合并先例（dsh-goal `lib/types/domain.d.ts:46-53`）：
```ts
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        'goal/change': GoalChangeMeta;
    }
}
```
known-event-types 是**封闭生成集**（known-event-types.js，47 项），文档原文：
> "Downstream (out-of-repo) plugin events are outside this list by construction; a registration surface for them is deferred until such a consumer exists."

执行拒绝点（dsh-session-persistence/lib/index.js:1117-1121）：
```js
assertEventsSupported(meta, events) {
    for (const event of events) {
        if (KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true) continue;
        throw this.unsupported(meta, `session "${meta.id}" contains event type "${event.type}" ... unknown to this harness and not marked ignorable; refusing to interpret the log ...`);
    }
}
```
而 `Session.append`（index.d.ts:212 + index.js:1444）**没有任何参数能写入 `ignorable: true`**（信封只有 type/seq/time/data/surface 元数据）；`ignorable` 只在 restore/seed 校验路径可读。

冷重建/重放 API（同文件）：
```ts
get events(): readonly SessionEvent[];   // 不可变快照，深冻结，seq 连续
get seq(): number;                        // = log.length
readonly firstLiveSeq: number;            // 本进程第一条（seed 边界）
deriveMessages(): Message[];              // 由 surface 投影的派生历史
// 事件流： ctx.on('session/event', (session, event) => {...})（emit 模式）
// 存活枚举： ctx.sessions.get(id) / ctx.sessions.list() / flush(session)
```

【结论】`append` 在运行时接受任意字符串 type（数据只做 lossless-JSON 校验），所以 `'gungnir/spec'` 能写入并实时广播；**但除非把 `'gungnir/spec'` 声明进合并的 `SessionEventMap` 之外还保证日志永不被持久化/恢复，否则 resume 时 `assertEventsSupported` 会因该类型既不在 47 项封闭集、又无法标记 `ignorable` 而拒绝加载整个会话** —— 自定义持久事件类型在本构建中事实上是“会写坏日志”的，需自担风险或改用 `'todo/write'` 类既有通道/进程外存储。

---

## 4. agent/pre-step

【包名】`@deepseek-ai/dsh-agent`

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`

原文摘录（runtime-types.d.ts:47-52 与 234-241）：
```ts
export type PreStepDecision = {
    kind: 'reject';
} | {
    kind: 'enter';
    messages: UserMessage[];
};
```
```ts
'agent/pre-step'(this: Scoped<Agent>, payload: {
    agent: Agent;
    messages: UserMessage[];
    turn: number;
    step: number;
    signal: AbortSignal;
}, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>;
```
监听方式是 cordis 事件约定：`ctx.on('agent/pre-step', (payload, next) => Promise<PreStepDecision>)`，`ctx.on` 签名（`@deepseek-ai/cordis/lib/types/events.d.ts:88`）：
```ts
on<K extends keyof Events>(name: K, listener: Events[K], options?: boolean | EventOptions): () => boolean;
```
waterfall 语义：不调 `next()` 即替换/否决；goal-round-driver 的真实监听器（`dsh-goal-round-driver/lib/index.js:281`）：
```js
ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
    const submitted = messages.find((message) => isGoalRoundSource(message.source));
    if (submitted === void 0) return next();   // 无 goal 消息 → 透传
    ...
    return { kind: "reject" };
});
```

【结论】签名即上；监听用 `ctx.on(..., handler)`，handler 为 `(payload, next) => Promise<PreStepDecision>`，放行必须 `return next()`，注入内容用 `return { kind:'enter', messages:[...] }`（替换整批 messages）。

---

## 5. tools/result

【包名】`@deepseek-ai/dsh-tools`

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts`

事件声明（emit 模式，index.d.ts:83）：
```ts
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined;
```
关键字段原文（index.d.ts:196-264 与 388-411）：
```ts
export interface ToolExecution extends ToolExecutionInput {
    readonly rootCallId: CallId;
    readonly token: ToolExecutionToken;
}
// ToolExecutionInput:
export interface ToolExecutionInput {
    readonly callId: CallId;
    readonly rootCallId?: CallId;
    readonly name: string;
    readonly arguments: unknown;      // 解析后深冻结的参数
    readonly agent?: Agent;
    readonly parent?: ToolExecutionToken;
    readonly signal: AbortSignal;
}
export interface ToolExecutionSuccess {
    readonly isError: false;
    readonly value: JsonValue;
    readonly content: ContentBlock[];
    readonly error?: never;
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: true;
}
export interface ToolExecutionFailure {
    readonly isError: true;
    readonly error: ToolFailure;      // { message: string; info?: { name: string; code: string } }
    readonly value?: never;
    readonly content: ContentBlock[];
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: never;
}
export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;
```
【结论】tool name = `exec.name`、callId = `exec.callId`、输出文本 = `result.content` 里的 `TextBlock`（`{type:'text', text}`）、成败 = `result.isError`（+`result.error.info.code`）；**没有 exit code 字段**——退出码由各 shell 工具放进 `content`/`meta`，类型层不存在。

---

## 6. ctx.commands

【包名】`@deepseek-ai/dsh-commands`

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-commands/lib/types/index.d.ts`

原文摘录：
```ts
export interface CommandInvocation {
    readonly commandId: CommandId;
    readonly agent: Agent;
    readonly rawInput: string;        // 斜杠名之后的原文（含空白）
    readonly attachments: readonly ImageBlock[];
    readonly signal: AbortSignal;
}
export interface CommandDefinition {
    readonly name: string;            // 无斜杠小写
    readonly description: string;
    readonly input?: CommandInputDescriptor;   // { hint: string; images?: boolean }
    readonly recordInput?: boolean;
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
export type CommandResult =
    | { readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: number }
    | { readonly kind: 'error'; readonly text: string };
export declare class CommandRuntime extends TypertRemoteService {
    register(definition: CommandDefinition): () => void;
    execute(agent: Agent, line: string, images: readonly EncodedImageAttachment[], signal: AbortSignal): Promise<CommandExecution | undefined>;
}
declare module '@deepseek-ai/cordis' { interface Context { commands: CommandRuntime } }
```
- **objective 参数**：`invocation.rawInput`（如 `/ultragoal do X` → `rawInput === "do X"`）。
- **发消息/起 turn**（`@deepseek-ai/dsh-agent` `Agent`，runtime-types.d.ts:109-132）：`agent.followup(message)`（排队新 turn 并唤醒）、`agent.send(message, 'next-turn'|'next-step', wakeup)`、`agent.steer(message)`、`agent.inject(message)`（不唤醒）。消息用 `createUserMessage({ content, source })` 构造。
- **ask-user**：`ctx.userQuestions.ask({ questions, agent, signal }): Promise<AskUserQuestionAnswer>`（`@deepseek-ai/dsh-user-questions/lib/types/index.d.ts:62`）；注意仅 runtime root agent 可问（子 agent 抛 `CALLER_NOT_LIVE`/`DELEGATED_CALLER`）。

【结论】`ctx.commands.register({ name:'ultragoal', description, input:{hint:'...'}, handler })`，handler 内用 `invocation.rawInput` 拿 objective、`invocation.agent.followup(createUserMessage(...))` 起 turn、`ctx.userQuestions.ask(...)` 问人。

---

## 7. ctx.tools.register

【包名】`@deepseek-ai/dsh-tools`（+ `defineTool` helper）

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts`（ToolRuntime.register:603）、`.../lib/types/schema.d.ts`（DefineToolOptions）

原文摘录：
```ts
register(definition: ToolDefinition): () => void;   // scoped 时注册进调用 agent 的 scope
```
```ts
export declare function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
    options: DefineToolOptions<S, O>): ToolDefinition;
// DefineToolOptions 关键字段：
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
    readonly name: string;
    readonly description: string;
    readonly parameters: S;                 // 声明式 JSON-value DSL，见下
    readonly output: {
        readonly schema: O;
        render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[];
        presentationMeta?(args, value): JsonValue;
    };
    readonly timeoutMs?: number;
    isConcurrencySafe?(args: InferArgs<S>): boolean;
    execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>;
    finalizeContent?(exec, result): ContentBlock[] | undefined;
    presentCall?(args): ToolCallView | undefined;
    presentResult?(args, result: ToolResult): ToolResultView | undefined;
}
```
参数 DSL（schema.d.ts:74-84）：`ParameterSchemaSpec = { [key]: ValueSchemaSpec & { required?: true } }`，值形如 `{ type:'string', required:true, description }`；`ToolRunContext` 附带 `deferContext(UserMessage)` 与 `concludeTurn()`（index.d.ts:283-300）。

真实用法（dsh-tool-ralph `lib/index.js:300`）：
```js
ctx.tools.register(defineTool({
    name: "ralph",
    description: DESCRIPTION,
    parameters: { objective: { type: "string", required: true, description: "..." },
                  maxRounds: { type: "number", description: "..." } },
    output: { schema: { type: "object", additionalProperties: false, properties: RALPH_OUTPUT_PROPERTIES },
              render: (_args, value) => [{ type: "text", text: renderResult(...) }] },
    async execute(args, exec) { ... }
}));
```
【结论】handler 收 `(args: InferArgs<S>（已校验）, exec: ToolRunContext)`，返回 `output.schema` 声明的 canonical JSON 值，模型可见内容由 `output.render` 从值投影成 `ContentBlock[]`——不是直接返回文本。

---

## 8. ctx.goals

【包名】`@deepseek-ai/dsh-goal`

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-goal/lib/types/index.d.ts`、`.../lib/types/types.d.ts`、`.../lib/types/domain.d.ts`

原文摘录（index.d.ts:45-153，全部方法）：
```ts
declare module '@deepseek-ai/cordis' { interface Context { goals: GoalService } }
export declare class GoalService extends TypertRemoteService {
    static inject: string[];                       // ['agents']
    static Config: z<{ defaultMaxGoalRounds?: number }>;   // 默认 256
    get(agent: Agent): GoalView | undefined;
    disarm(agent: Agent): GoalView | undefined;
    create(agent: Agent, request: CreateGoalRequest): GoalView;
    edit(agent: Agent, ref: GoalRef, request: EditGoalRequest): GoalView;
    pause(agent: Agent, ref: GoalRef): GoalView;
    resume(agent: Agent, ref: GoalRef): GoalView;
    complete(agent: Agent, ref: GoalRef): GoalView;
    block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView;
    clear(agent: Agent, ref: GoalRef): GoalRef;
}
export interface GoalRef { readonly id: GoalId; readonly revision: number }
export interface CreateGoalRequest { readonly objective: string; readonly maxGoalRounds?: number }
export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete';
export interface GoalBlockReason { readonly code: string; readonly message: string }  // code: lower-kebab-case
export interface GoalView extends GoalSnapshot { roundsStarted; createdAt; updatedAt; activation: 'armed'|'disarmed' }
```
goal/change 事件（domain.d.ts:76-90）：
```ts
'goal/changed'(this: Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void;   // @mode emit
export interface GoalChanged { readonly operation: GoalOperation; readonly ref: GoalRef; readonly goal?: GoalView }
```
注意 CAS 语义：所有变更必须传**当前 revision** 的 GoalRef（stale 抛 `GOAL_STALE_REVISION`）；所有 API 要求 agent 是 `ctx.agents` 里的精确 live 实例；armed/disarmed 是进程本地态（resume 会话后默认 disarmed，需显式 resume 重新 arm）。

【结论】`ctx.goals.create(agent, {objective, maxGoalRounds})` 起、`get(agent)` 读当前 goal、`edit/pause/resume/complete/block/clear(agent, {id, revision}, ...)` 变更、`ctx.on('goal/changed', ...)` 订阅。

---

## 9. ctx.llm

【包名】`@deepseek-ai/dsh-llm`

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts`、`.../lib/types/types.d.ts`

原文摘录：
```ts
declare module '@deepseek-ai/cordis' {
    interface Context { llm: LlmRuntime }
    interface Events {
        'llm/stream'(this: LlmRuntime, options: GenerateOptions,
            next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;   // @mode waterfall
    }
}
export declare class LlmRuntime extends Service {
    registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle;
    listProviders(): LlmProviderInfo[];
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>;
    prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export interface GenerateOptions {
    provider: string;
    model: string;
    reasoningEffort?: ReasoningEffortId;
    messages: Message[];
    system?: string;
    tools?: ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
    signal?: AbortSignal;
    sessionId?: Branded<'SessionId'>;
    purpose?: 'compaction' | 'session-title';
}
```
【结论】调用 API 是 `await ctx.llm.stream(options)` → `AsyncIterable<StreamChunk>`（chunk 带 `block: ContentBlock`/`finish` 等，自行拼装文本）；**没有原生 structured output**——`GenerateOptions` 无 `response_format`/`json_schema` 字段，仓库内的结构化输出走 workflow/subagent seam（ralph 的 `agent(prompt, { schema })`），或拿到 JSON 后自行校验。

---

## 10. Agent.inject

【包名】`@deepseek-ai/dsh-agent`（Agent）、`@deepseek-ai/dsh-llm`（UserMessage 构造与 MessageSource）

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:132`、`<dsh>/node_modules/@deepseek-ai/dsh-llm/lib/types/message.d.ts`

原文摘录：
```ts
inject(message: UserMessage): void;
// 文档： Queue model-facing context for the next pre-step WITHOUT waking the driver.
```
```ts
export interface MessageSourceMap {
    user: { kind: 'user' };
    plugin: { kind: 'plugin'; plugin: string } & ContextFormed;   // ← 插件可用
    model: ModelMessageSource;
    tool: ToolMessageSource;
}
export type ContextFormed =
    | { readonly form?: never }
    | { readonly form: 'instructions' } | { readonly form: 'catalog' }
    | { readonly form: 'snapshot'; readonly sections: readonly ContextSnapshotSection[] }
    | { readonly form: 'notice'; readonly summary: string }        // ≤ CONTEXT_SUMMARY_MAX_CHARS = 120
    | { readonly form: 'relay' } | { readonly form: 'recall' };
export declare function createUserMessage<T extends NewUserMessage>(input: T & { id?: never; role?: never }):
    T & Pick<UserMessage, 'id' | 'role'>;
// UserMessage = Message & { role: 'user' }; Message = { id; role; content: ContentBlock[]; source: MessageSource }
```
自定义 source 的先例（dsh-goal `lib/types/domain.d.ts:34-45`）：
```ts
export interface GoalMessageSource { readonly kind: 'goal'; readonly goalId: GoalId; readonly revision: number; readonly round: number }
declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { goal: GoalMessageSource } }
```
你的插件的 source 两种写法：直接用 `{ kind: 'plugin', plugin: 'gungnir', form: 'notice', summary: '...' }`，或仿 goal 合并 `MessageSourceMap` 加 `gungnir` kind。构造示例：`createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'gungnir', form: 'notice', summary } })`。

【结论】`agent.inject(msg)` 只投递到下一个 pre-step 不唤醒；要立即起 turn 用 `agent.followup(createUserMessage(...))`；`ContentBlock` 文本块是 `{ type: 'text', text: string }`。

---

## 11. goal-round-driver

【包名】`@deepseek-ai/dsh-goal-round-driver`

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/types/index.d.ts`；实现 `lib/index.js`

原文摘录（index.d.ts 全文核心）：
```ts
export declare const name = "goal-round-driver";
export declare const inject: string[];              // 运行时 = ['agents','goals','sessions']
export declare function apply(ctx: Context): void;  // 注意：无 config 参数
```
它的 pre-step 监听（lib/index.js:281）：`ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {...})`；行为：仅当 `messages` 里存在 `source.kind === 'goal' && round > 0` 的消息才介入（校验 reservation，失败 `return { kind: 'reject' }`），否则 `return next()` 透传。它还监听 `agent/error`、`agent/created`、`agent/disposed`、`agent/session-start`、`agent/status`、`goal/changed`、`agent/inbox/*`、`session/event`。

配置：**驱动自身零配置**；轮数上限来自 goal 本身——`ctx.goals.create` 的 `maxGoalRounds`，未给时用 `@deepseek-ai/dsh-goal` 的 `Config.defaultMaxGoalRounds`（默认 **256**）。没有 `max_goal_rounds` 这个键名。

共存顺序：cordis waterfall 按监听注册顺序组合（先注册者在外层）。你的监听器若在驱动之后加载，就运行在驱动 `next()` 之内；只要你的注入消息的 source 不是 goal-round 源，驱动不会拦截你的 step——你的 `{kind:'enter'}` 替换 messages 时若把队列里的 goal 源消息丢弃，会在下一轮被驱动的 stale 检查拒掉（它按 message id 找 `submitted`）。最终顺序取决于 harness 配置里的插件加载顺序。

【结论】注入依赖 `['agents','goals','sessions']` 无碍共存；不要复用 `kind:'goal'` 的 source（那是驱动保留通道）；轮上限在 goal 域配置（defaultMaxGoalRounds=256 / 每-goal maxGoalRounds）。

---

## 12. ctx.storage

【包名】`@deepseek-ai/dsh-storage`（hub）、`@deepseek-ai/dsh-storage-json`（内置 backend，注册名 `"json"`）

【文件路径】`<dsh>/node_modules/@deepseek-ai/dsh-storage/lib/types/index.d.ts`、`.../lib/types/backend.d.ts`

原文摘录：
```ts
declare module '@deepseek-ai/cordis' { interface Context { storage: Storage } }
export declare class Storage extends Service {
    readonly backend: BackendRegistry;
    mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void;
    form<K extends keyof StorageForms>(form: K): StorageForms[K];
    get domain(): ...;   // dsh-storage-domain 挂载的领域数据 form
}
export interface StorageBackend { readonly kv?: KvFacet; close(): Promise<void> }
export interface KvFacet { open(descriptor: KvUnitDescriptor): Promise<KvUnit> }
export interface KvUnitDescriptor {
    readonly name: string;       // 须匹配 UNIT_NAME_RE
    readonly version: number;    // 首次物化时盖章；不匹配 → 'version-mismatch'
    readonly tables: readonly string[];
    readonly hasGlobal: boolean;
}
export interface KvUnit {
    loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>;
    putRecord(table: string, key: string, value: unknown): Promise<void>;
    deleteRecord(table: string, key: string): Promise<void>;
    setGlobal(value: unknown): Promise<void>;
    close(): Promise<void>;
}
export declare function storageBackendServiceKey(name: string): string;  // 后端生命周期服务键
```
dsh-storage-json 实测（lib/index.js:288）：`ctx.storage.backend.register("json", backend)`。

【结论】存在：插件本地持久化 = 取 `KvFacet`（`ctx.storage.backend` 解析 `"json"` 后端或注入 `storageBackendServiceKey('json')` 对应服务），`open({name, version, tables, hasGlobal})` 后用 `putRecord/deleteRecord/setGlobal` 做每记录持久 KV——比往 session log 塞自定义事件安全得多。

---

### 附注（影响代码写法的两点）
- `Session.append` 对未知 type 不做运行时校验，但 **dsh-session-persistence 的 resume 路径（lib/index.js:958/979/994/1291 均调用 assertEventsSupported）会因 47 项封闭集之外且无 `ignorable` 的类型拒绝整个会话**，且 `ignorable` 无公开写入通道——第 3 点的最大坑，插件持久状态建议走 `ctx.storage` 或仅存进程内。
- 所有 `agent/*`、`tools/*`、`session/*`、`goal/changed` 事件都是 `@deepseek-ai/dsh-scope` 的 scope-filtered 派发；在根 ctx 注册的监听器收到全部 agent，在 `agent.ctx`（或 agent scope 子 ctx）注册的只收到该 agent。