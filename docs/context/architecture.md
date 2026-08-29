# 架构地图（L1）

> 目标读者：要写代码或做技术决策的会话。只讲结构与边界，why 在 [decisions.md](decisions.md)，执行细节在计划文档。

## 1. 分层图（全仓库唯一分层真理）

```text
┌─────────────────────────────────────────────┐
│ Gungnir GoalSpec / Goal Contract            │  Lock the goal：什么必须成真？
├─────────────────────────────────────────────┤
│ Gungnir Adaptive Loop Runtime               │  Adapt the loop：冻存资产
│ 【冻存为 escalation 后端，默认不加载、       │
│   不继续 patch；重开须另立 ADR（ADR-0017）】 │
├─────────────────────────────────────────────┤
│ Gungnir Evidence / Verifier / Reconciler    │  Prove + Observe：被动取证，静默验证，
│ （+ Passive Plane：wrapup 验证钩子 + S1/S2   │  有证据出问题才出手
│   判据 + MAF 最小介入反馈）【P1 判决：C2a     │
│   形态成立；运行期介入随退出线收缩为离线资产， │
│   ADR-0018】                                │
├─────────────────────────────────────────────┤
│ DSH Agent Contract / Session Log / Services │  稳定机制层（不改源码，driver 可配置替换）
├─────────────────────────────────────────────┤
│ Tools / LLM / Sandbox                       │  实际操作层
└─────────────────────────────────────────────┘
```

位置判定法：任何模块必须能回答"我在哪一层"。Gungnir 在上面三层新增代码；DSH 机制层只消费其公开 contract 与服务，**源码一行不改**——替换默认 agent-loop 走的是官方组合接缝（bundles 清单），与模型适配器、工具注册表同级（ADR-0012）。

**机制/策略分离**（ADR-0012 第 3 条）：机制层保持稳定——Agent contract、session identity、append-only ledger、tool safety/permission、cancellation、persistence/replay、observability。策略层允许激进变化——context projection、model、reasoning budget、工具呈现与执行策略、branching、validation/retry/stop policy、planning depth、subagent topology、workflow strategy。

**架构原则 AP-1～AP-6**（ADR-0017 冻结，全文见 `AGENTS.md` §2.1，与铁律同级执行）：fast path 不付控制面税（AP-1）；Agent 永不调试 supervisor（AP-2）；形式化渐进 L0/L1/L2（AP-3）；证据触发验证而非计划位置（AP-4）；锁目标不锁手脚（AP-5）；裁决面向任务不面向协议（AP-6）。

## 2. 包结构（当前形态 + 二阶段新增）

```text
packages/core        @gungnir/core      纯域函数：schema / fold(strict replay) / reconciler 决策表 /
                                         verifier 契约 / loop 路由规则（二阶段）。零 DSH 依赖，
                                         可全量单测，是"从 ledger 重建可信"的前提
packages/dsh-plugin  dsh-gungnir         Prove 层 cordis 插件：命令 / 工具 / 事件监听 /
                                         ledger append / verifier 实现 / LLM 调用
packages/agent-loop  @gungnir/agent-loop 【二阶段建成；冻存为 escalation backend 资产（ADR-0017），默认不加载、不继续 patch】
                                         Adaptive Loop Runtime：实现 Agent contract 的 driver，
                                         三模式 FAST/EXECUTE/VERIFY + 确定性 router；经组合
                                         接缝替换 dsh-agent-loop（ADR-0014 两步法）
tools/               destruction/        破坏注入 harness
                     experiments/        实验跑批（一阶段 20 任务生死实验；二阶段四组对照实验）
```

依赖方向单向：`dsh-plugin → core`、`agent-loop → core`，反向禁止。`core` 不知道 session log 的存在，只认识事件数组。

## 3. 运行时数据流

### 3.1 现役（一阶段形态，跑在默认 driver 上）

```text
/ultragoal → gungnir/spec
  → reconcile: plan-projection(advisory) + commit 一个 action → goal-round-driver 排轮
  → pre-step 注入 reconcile 指令 → 模型执行（工具调用）
  → tools/result → gungnir/evidence；模型 gungnir_report → gungnir/claim
  → 轮末 Verifier 跑 predicate → gungnir/verdict
  → reconcile 决策（ADVANCE/REPLAN/RETRY/BLOCKED/NEEDS_HUMAN/REVALIDATE）→ gungnir/status
  → 继续 / 终止（COMPLETE 前必须 GOAL_REVALIDATION 全量重验）
```

### 3.2 Adaptive Loop 形态（二阶段已建成并实证；当前按熔断判定暂停启用）

> **2026-08-29 状态**：AdaptiveLoopAgent v0（FAST/EXECUTE/VERIFY + 确定性 router + loop 事件落账）已建成并经四组对照实验实证——冻结门判定 FAIL（小型任务面成本不回本），替换默认 loop 路线按预注册熔断暂停（ADR-0015、《二阶段阶段报告》）；post-mortem 进一步把归因修正为"协议税而非验证税"（《二阶段-postmortem》，ADR-0017）。本层代码与替换机制（ADR-0014 两步法）**冻存为 escalation 后端资产：默认不加载、不继续 patch，重开须另立 ADR**；"作为 escalation backend 被罕见调用即回本"仍是未测假设，留给 spike 测量，不计入已兑现价值。现役运行形态为 §3.1 的 passive 化演进，目标形态见 §3.3。

```text
用户输入 / goal round
  → AdaptiveLoopAgent（session 生命周期内单实例）
  → meta-controller：state + observations + goal + budget + risk → 选定 LoopStrategy
  → strategy 执行一个步进单元（FAST=直答 / EXECUTE=批量工具·Code Mode / VERIFY=确定性验证…）
  → 全部 turn/step/tool 事件照常写 session log（账本不换）；loop/* 事件写 Gungnir ledger
  → 轮末 Evidence → Verifier → Reconcile（Prove 层不变）
  → 反馈信号进 meta-controller，hysteresis 守卫下决定下一策略
```

事件全集与 fold 规则见《一阶段实施详细计划》§4；状态机守卫见 §6。
**事件载体（ADR-0006）**：所有 `gungnir/*` 事件写入 `ctx.storage` 的 KV ledger（`gungnir-ledger` unit，append-only，按 agentId+seq 键控），**不写 session log**——DSH persistence 白名单封闭，自定义 durable 事件类型会被 resume 拒载（dsh-interface.md §4）。loop 事件同样走此 ledger（命名空间 ADR-0005 已预留，ADR-0012 二阶段起接入）。

### 3.3 目标形态（三阶段，ADR-0017）：Passive Proof Plane

```text
用户 → Native DSH / Code-PTC（fast path，主 Agent 不参与 Gungnir 协议）
  → 工具 → 现实
      │
      └─→ 插件被动监听（tools/result、session 事件）→ gungnir/evidence → GoalStatus
            │
            ▼  wrapup seam（回合收尾的结构事件，天然验证钩子；禁文本挖掘）
        确定性验证（L1/L2/L3；L4 禁用中）
            │
        ┌───┴────┐
      通过      证据冲突
        │          │
      零打扰    一条 Minimal Actionable Feedback（面向任务，不暴露协议内部）
```

判据来源三层（spike 第一预注册问题）：S1 通用不变量（零协议，真 0-cost）；S2 一次性轻量捕获（至多 1 个额外往返）；S3 外部供给（harness 配置 / CI / 用户验收测试）。细则与判定门见《[三阶段-Passive-Proof-Spike计划](../plan/三阶段-Passive-Proof-Spike计划.md)》。

## 4. 关键边界

- **与默认 agent-loop**：一次性组合替换，session 生命周期内实例稳定；运行期只切 Loop Strategy。**禁止物理热插拔**（open turn / open step / pending tool call / active AbortSignal 下不做实例级替换，不并发双 driver）。替换实现必须完整承担 driver 职责：agent 生命周期、turn/step 边界、工具调度、teardown。
- **与 session log**：换执行层不换账本。turn/start → step/start → request → tool/call → tool/result → step/end → turn/end 这一系 durable 事件的语义必须保持，resume/fork 不回归（二阶段验收 B3）。
- **与 native goal**：续轮复用 `goal-round-driver`；Gungnir 不代模型调 `update_goal`，只通过 pre-step 指令引导模型走合法路径完成/阻塞；状态不一致时报警不代写。
- **与 evidence**：只有 harness 观测事实（`tools/result`、exit code、文件状态、环境采样）可成为 evidence；模型输出一律是 claim。
- **与安全**：sandbox/approval authority 归 DSH 原 owner；Gungnir 的 verifier 命令执行走 harness 执行器，不私开进程越权。
- **与 cache**：各模式用有限状态模板（稳定 system prefix + 稳定 tool schema），变化信息放尾部 state payload；不逐步动态生成 prompt（ADR-0012 第 6 条）。

## 5. 部署形态

DSH 树外插件：用户 `dsh plugin --profile <name> add dsh-gungnir` 安装进 profile，经 `cordis.patch.yml` 分层组合。开发期用本地路径 add。二阶段起 profile 的 bundles 清单中默认 agent-loop 行替换为 Gungnir loop 包（确切机制为 OPEN-7，二阶段 M0 实证，见 [dsh-interface.md](dsh-interface.md) §3/§14）。
