# docs/context — 上下文管理方案（渐进式披露）

> **所有会话（人或 agent）进入本仓库的第一入口。** 原则：按需取上下文，禁止全量阅读。本文件之外不存在第二个入口。

## 1. 分层模型

| 层 | 内容 | 何时读 | 体量预算 |
|---|---|---|---|
| **L0 常读** | 本 README、[project-brief](project-brief.md)、[state](state.md) | 每次会话开始 | 三件合计 ≤ 250 行 |
| **L1 入门** | [architecture](architecture.md)、[glossary](glossary.md)、[decisions](decisions.md) | 新协作者一次性读完；老手只在相关时查 | 每件 ≤ 200 行 |
| **L2 按需** | [dsh-interface](dsh-interface.md)、`docs/plan/一阶段实施详细计划.md` | 做对应工作时读 | 事实手册，只增不删（过期条目标记而非删除） |
| **L3 深层** | `docs/plan/全阶段实施计划.md`、`docs/idea/*`（思想源文档，只读）、[dsh-interface-detail](dsh-interface-detail.md)（接缝勘察证据附录，只存档不更新）、各包 README、DSH 上游文档 | 仅当 L0–L2 无法回答"为什么"时 | 无限制 |

披露规则：

1. **入口唯一**：从本 README 进，按读取路径矩阵跳转。
2. **链接优于复制**：每个事实只有一个权威家（DSH 接口事实只在 dsh-interface.md；决策只在 decisions.md；术语定义只在 glossary.md），他处引用链接。
3. **结论优于原文**：`docs/idea/` 的结论已蒸馏进 project-brief 与 decisions；只有当结论被质疑时才回读原文。
4. **超预算即下沉**：任何文件超过层预算，把细节下沉到 L3 并在原处留链接。

## 2. 读取路径矩阵

| 你要做什么 | 必读 | 按需加读 |
|---|---|---|
| 新会话起步 / 接续上次工作 | L0 三件 | — |
| 写一阶段代码 | + architecture、dsh-interface、一阶段计划 | glossary（术语不清时）、decisions（动到已决策领域时） |
| 架构 / 接缝 / 技术选型 | + dsh-interface、decisions | idea 原文（结论有争议时）、DSH 上游 README |
| 新增或修改 Verifier | + 一阶段计划 §5、glossary（阶梯定义） | — |
| 测试 / 破坏测试 / 实验 | + 一阶段计划 §9 | — |
| 升级 DSH 版本 | + dsh-interface（含接缝回归清单） | — |
| 理解项目为什么长这样 | + decisions（全部 ADR） | idea 三篇 |
| 阶段收尾 / 写 stage report | + 全阶段计划、state | — |

## 3. 更新义务（谁改谁更新，随代码同批提交）

| 触发 | 动作 |
|---|---|
| 每个工作块结束 | 更新 [state.md](state.md)：done / in-flight / next / blockers |
| 做出或推翻决策 | 在 [decisions.md](decisions.md) 新增 ADR（不删旧的） |
| 架构 / 模块边界变化 | 同步 [architecture.md](architecture.md) |
| 新术语 / 概念 | 进 [glossary.md](glossary.md) |
| 实测发现 DSH 行为与记录不符 | 以实测为准，回写 [dsh-interface.md](dsh-interface.md) 并附验证方式与 DSH 版本 |
| 阶段结束 | state.md 写 stage report 摘要；修订对应计划的状态行 |

## 4. 目录索引

```text
docs/context/
├── README.md          # 本文件：入口 + 披露规则
├── project-brief.md   # L0 项目速览（是什么/为什么/当前阶段）
├── state.md           # L0 活文档（当前状态，每次工作块更新）
├── architecture.md    # L1 架构地图（分层、包结构、数据流）
├── glossary.md        # L1 术语表（Gungnir 域 + DSH 域）
├── decisions.md       # L1 决策记录（ADR 索引）
├── dsh-interface.md   # L2 DSH 接口事实手册（实测，含回归清单）
└── dsh-interface-detail.md # L3 接缝勘察原始报告（dsh-interface.md 的证据附录，只存档不更新）
```
