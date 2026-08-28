# 当前状态（L0 活文档）

> 每个工作块结束必须更新。最新在上，旧条目按时间下沉归档。

## 快照（2026-08-28 · 工作块 2）

- **阶段**：一阶段（Gungnir Core）开工。
- **已完成**：repo 骨架（pnpm workspace / TS strict / vitest / eslint）；DSH 接缝深勘回写 [dsh-interface.md](dsh-interface.md)（§2/§4/§5/§6 更新，新增 §9–§13）；**ADR-0006 归档**：ledger 载体 = `ctx.storage` 独立 KV ledger（session log 自定义 durable 事件实测不可用——persistence 白名单封闭，resume 拒载）；**ADR-0007 归档**：复用 goal-round-driver + pre-step"追加不替换"注入。
- **阻塞**：无。

## 下一步

1. `@gungnir/core`：schema v1（M0 冻结）、fold（strict replay）、reconciler 决策表、verifier 契约 + 全单测（A4/A5）。
2. `dsh-gungnir` 插件：storage ledger、evidence 捕获、三 verifier、surfaces、pre-step（M2–M4 代码）。
3. dev profile 冒烟（A1）与破坏矩阵（A2）——ledger 已改走 ctx.storage，D-5（compact）风险随之消除。

## 工作日志（倒序）

- **2026-08-28（工作块 2）**：M0 repo 骨架落盘；接缝深勘（子代理逐包 .d.ts + 编译后 JS）：OPEN-1 结论为否定（自定义 session 事件类型无法通过 resume 白名单），OPEN-2 代码级验证通过；ADR-0006/0007 归档；dsh-interface.md 回写。
- **2026-08-28**：完成全项目规划。读毕 `docs/idea/` 三篇全文；实测勘察 dsh@0.1.1-rc.2（CLI、profile 机制、插件形态、事件词汇表、goal 域语义、Windows 栈）；产出全阶段计划、一阶段详细计划、AGENTS.md、本上下文方案。决策 ADR-0001～0005 归档。
