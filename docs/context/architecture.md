# 架构地图（L1）

> 目标读者：要写代码或做技术决策的会话。只讲结构与边界，why 在 [decisions.md](decisions.md)，执行细节在计划文档。

## 1. 四层架构（全仓库唯一分层真理）

```text
┌─────────────────────────────────────────────┐
│ Gungnir GoalSpec / Goal Contract            │  What must become true?（二阶段完全体）
├─────────────────────────────────────────────┤
│ Gungnir Reconciler + Adaptive Loop Plane    │  How should I work NOW?（一/三阶段）
├─────────────────────────────────────────────┤
│ DSH Agent / Goal / Workflow / Subagent      │  Execute the chosen policy（DSH 原生，不改）
├─────────────────────────────────────────────┤
│ Tools / LLM / Sandbox                       │  Perform actual operations（DSH 原生，不改）
└─────────────────────────────────────────────┘
```

位置判定法：任何模块必须能回答"我在哪一层"。Gungnir 只在第 1、2 层新增代码；第 3、4 层只消费 DSH 已有服务与事件。

## 2. 包结构（一阶段形态）

```text
packages/core        @gungnir/core      纯域函数：schema / fold(strict replay) / reconciler 决策表 / verifier 契约
                                         零 DSH 依赖 —— 可全量单测，是"从 ledger 重建可信"的前提
packages/dsh-plugin  dsh-gungnir         cordis 插件：命令 / 工具 / 事件监听 / ledger append / verifier 实现 / LLM 调用
tools/               destruction/        破坏注入 harness
                     experiments/        20 任务实验跑批
```

依赖方向单向：`dsh-plugin → core`，反向禁止。`core` 不知道 session log 的存在，只认识事件数组。

## 3. 运行时数据流（一阶段一轮）

```text
/ultragoal → gungnir/spec
  → reconcile: plan-projection(advisory) + commit 一个 action → goal-round-driver 排轮
  → pre-step 注入 reconcile 指令 → 模型执行（工具调用）
  → tools/result → gungnir/evidence；模型 gungnir_report → gungnir/claim
  → 轮末 Verifier 跑 predicate → gungnir/verdict
  → reconcile 决策（ADVANCE/REPLAN/RETRY/BLOCKED/NEEDS_HUMAN/REVALIDATE）→ gungnir/status
  → 继续 / 终止（COMPLETE 前必须 GOAL_REVALIDATION 全量重验）
```

事件全集与 fold 规则见《一阶段实施详细计划》§4；状态机守卫见 §6。
**事件载体（ADR-0006）**：所有 `gungnir/*` 事件写入 `ctx.storage` 的 KV ledger（`gungnir-ledger` unit，append-only，按 agentId+seq 键控），**不写 session log**——DSH persistence 白名单封闭，自定义 durable 事件类型会被 resume 拒载（dsh-interface.md §4）。

## 4. 关键边界

- **与 native goal**：续轮复用 `goal-round-driver`；Gungnir 不代模型调 `update_goal`，只通过 pre-step 指令引导模型走合法路径完成/阻塞；状态不一致时报警不代写。
- **与 evidence**：只有 harness 观测事实（`tools/result`、exit code、文件状态、环境采样）可成为 evidence；模型输出一律是 claim。
- **与安全**：sandbox/approval authority 归 DSH 原 owner；Gungnir 的 verifier 命令执行走 harness 执行器，不私开进程越权。
- **与未来（三阶段）**：ledger 预留 `gungnir/loop-state`、`gungnir/loop-transition`；LoopPolicyVector 只通过 DSH 现有扩展点（pre-step、tools/pre-execute、agent/request、goal round 控制）作用，永远不碰 `agent-loop`。

## 5. 部署形态

DSH 树外插件：用户 `dsh plugin --profile <name> add dsh-gungnir` 安装进 profile，经 `cordis.patch.yml` 分层组合。开发期用本地路径 add。机制详见 [dsh-interface.md](dsh-interface.md)。
