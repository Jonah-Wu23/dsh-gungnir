# 当前状态（L0 活文档）

> 每个工作块结束必须更新。最新在上，旧条目按时间下沉归档。

## 快照（2026-08-28 · 工作块 3）

- **阶段**：一阶段（Gungnir Core）M0–M4 代码完成，M5 未开始。
- **已完成**：
  - M0/M1：repo 骨架；ADR-0006/0007 归档；`@gungnir/core` 全套（schema v1 冻结、fold strict replay、reconciler 决策表+熔断+阶梯强制、verifier 契约、digest）；**79 单测全绿，coverage 97.7% stmts / 95.4% branches（A4 ✓）**。
  - M2–M4 代码：`dsh-gungnir` 插件（ctx.storage KV ledger、evidence 捕获、L1/L2/L4 三 verifier、reconcile 闭环引擎、`/ultragoal`+`/gungnir` 命令、`gungnir_submit_spec/plan/report` 工具、pre-step 追加注入）；bundle patch 已入 `dsh.profile` 层栈。
  - 装载实测：`dsh plugin add` + `--dump-config` 显示 gungnir/storage 行 ✓；`dsh --profile headless` **真实 boot 通过**（apply() 运行无异常），止于 `MISSING_CREDENTIAL`（本机无 DEEPSEEK_API_KEY）。
  - 修复过的实测问题：cordis inject 强制声明（补全 7 个服务键）；storage-json 需要 `root`（`!!js dshHomePath('storage')`）。
- **阻塞**：无 API key，A1 端到端（spec→round→evidence→verdict→status→complete）无法在本机跑通；需在有 DEEPSEEK_API_KEY 的环境执行 `dsh --profile headless "..."` 续验。

## 下一步

1. **A1 续验**（有 key 环境）：headless 全链路 + 接缝回归清单 §14 全部条目；重点实测 turn-stopping payload 形状、KvFacet 解析路径、llm stream chunk 形状（插件内均已有防御式处理与日志）。
2. ExitCode verifier 接线：确认 harness 命令执行器接缝后替换 INCONCLUSIVE stub（沙箱 authority 合规）。
3. M5：destruction harness（§9.2 矩阵 D-1~D-6，ledger 已改 ctx.storage 后 D-5 compact 风险消除）+ 20 任务生死实验（§9.3）。
4. `tools/`（destruction/experiments）骨架未建。

## 工作日志（倒序）

- **2026-08-28（工作块 3）**：M2–M4 插件代码完成并 build/typecheck 绿；发现并落地 dsh.bundle.patch 机制（manifest `dsh.bundle.patch` → 自动入 bundles 层）；headless 真实 boot 通过（无凭据止于 MISSING_CREDENTIAL）；architecture.md/AGENTS.md 铁律 2 同步 ADR-0006 载体勘误；两包 README 落盘。
- **2026-08-28（工作块 2）**：M0 repo 骨架落盘；接缝深勘：OPEN-1 结论为否定（自定义 session 事件类型无法通过 resume 白名单），OPEN-2 代码级验证通过；ADR-0006/0007 归档；dsh-interface.md 回写。
- **2026-08-28**：完成全项目规划。产出全阶段计划、一阶段详细计划、AGENTS.md、上下文方案。决策 ADR-0001～0005 归档。
