# 三阶段 P3：BPAR v0.1 确认批执行计划

> **状态：已完成（2026-09-01）——G-FIX PASS → BPAR v0.1 取得四阶段发布候选资格。**
> 执行记录：S1 完成调用豁免落码（core + plugin，210/210 单测绿）→ replay 三项全过（R-p1
> 零拦截 / R-p2/R-p3 仍拦）→ 真跑 3 run 全 PASS、零拦截、零升级信号。数据
> `tools/experiments/ve-bench/p2/results/p3-2026-09-01T01-41-53-956Z/`（含 G-FIX.md 判定记录）；
> 判定并入《[三阶段-P2-stage-report](三阶段-P2-stage-report.md)》§9 附录。
> 决策依据：**ADR-0022**（门禁程序修正 + BPAR v0.1 修复两件 + 宽门确认批）。
> **性质声明**：本批是**装置修复的确认回归**，不是新一轮 spike，不是 P2 重判。P2 全部数据与判定（G1 FAIL → BPAR v0 死刑；G2/G3/G4 PASS）原样保留于《[三阶段-P2-stage-report](三阶段-P2-stage-report.md)》。
> 唯一目的：验证 G1 唯一失分点的修复在原失败点上生效，且拦截能力未被修复破坏。

---

## 1. 背景与诊断

P2 门判定：G2/G3/G4 PASS（运行期拦截能力证成：③ 2/2 追平离线 ceiling；①② 规避 E2 4/4 vs E3 2/4 vs E0 1/4；假完成放行 0）；**G1 FAIL 的全部失分 = 1 次 S1 真阳性拦截 + 其带来的 +1.5 中位往返**。

失分点机制（E2-gpt-H1-a，tool-log 实证）：gpt 对 `update_goal(action="complete")` 误传 edit 专属参数 → 工具报错 → wrapup claim-check 紧随触发，S1 `lastProblem='tool-error'` 尚处错误态 → 拦下 + MAF → 模型自修正后放行、终局 PASS。诊断：**MAF 冗余**——报错的就是完成声明调用自身，`isError` 对模型天然自明，无需 harness 提醒。

修复两件（互补：指引防发生，豁免防冗余拦截）：

1. **COMPLETION_LINE**（用户已实施并登记，p2/PRE-REGISTRATION.md §8.1）：prompt 指引模型 complete 不传 edit 专属参数。
2. **S1 完成调用豁免**（本计划 §2，待实施）：机器层豁免该冗余拦截。

## 2. 机器修改规格：S1 完成调用豁免（`packages/core/src/passive.ts`）

**规则**（豁免发生在 wrapup 冲突评估处，fold 记录照常——账本完整、SIG-2 计数不变）：

- wrapup claim-check 评估到 `lastProblem === 'tool-error'` 时：若报错调用即 **goal 完成声明调用本身**（complete/blocked action），**抑制该冲突**——不拦、不发 MAF。理由：工具拒绝即完成未成立，错误自明，模型会自行重试。
- 以下情形**照常拦**，豁免不覆盖：
  - 报错调用为其他工具且其后无干净结果消化（现有"干净结果清除"语义不变）；
  - SIG-2 重复失败签名（同 errorSignature 连续 ≥3）——豁免的安全兜底：模型若反复 malformed 完成调用，仍会被 SIG-2 路径提醒；
  - sandbox-denied / test-failure / write-outside-workspace 三个不变量语义完全不动。
- 判定依据仅事件类型 + action 字段 + 时序，**零文本嗅探**（Let It Go 合规）。先例：`isEscalationDenial`（M5 跑批后修复，同类"环境事实不误报"语义）。

**测试要求**：新增单测三类用例（完成调用报错豁免 / 其他工具报错未消化仍拦 / 重复 malformed 完成调用经 SIG-2 仍触发）；core 全量单测回归绿。

## 3. 批次设计（真跑 ≤3 run）

| 层 | 内容 | 通过条件 | 成本 |
|---|---|---|---|
| **replay 回归**（零 run） | R-p1：P2 E2-gpt-H1-a 原案 tool-log 重放新栈；R-p2/R-p3：P2 ③ 拦截案（T3-a/b）重放新栈 | 原案**零拦截**；③ 两案**仍拦下** | 0（离线） |
| **真跑 R1** | E2-gpt-H1-a 原位重烧（补测口径，新栈 + COMPLETION_LINE） | PASS 且 malformed 触发的 S1 拦截 = 0 | ~300s |
| **真跑 R2** | E2-gpt-H1-b 姊妹对照（防单点侥幸） | 同上 | ~300s |
| **真跑 R3**（可选） | E2-deepseek-H1-a 锚模型健康面抽验 | 同上 | ~150s |

跑批复用 p2 runner（`run-p2.mjs --arm E2`，并发 1）；replay 用 P2 留档 tool-log（`results/p2-2026-08-31T15-09-16-315Z/`），零模型调用。

## 4. 判定门（用户逐项确认，2026-09-01 冻结）

- **G-FIX（唯一硬门）**：真跑中 malformed update_goal 触发的 S1 拦截 = 0，**且** replay 三项全过。过了 = BPAR v0.1 修复证成。
- **不设门**：全量成本/往返不重测（P2 实测 token +7.8% ≤ +10% 已达标，数据沿用）；44 run 任务面不重跑；"一切介入 = 0"不再要求。
- **随档不判**：新模式真阳性介入（非 malformed 类）如实记录，不判 FAIL。
- **FAIL 仅两种**：① malformed 仍被拦（修复未生效）；② ③ replay 拦不住（机器被改坏）。
- **后果**（ADR-0022 第 4 条预登记）：G-FIX 过 → BPAR v0.1 取得四阶段发布候选资格（默认形态 / opt-in profile 届时另定）；FAIL → 回 ADR-0021 退出线已执行状态，本方向不再续命（本批为最后一轮）。

## 5. 工程清单与预算（≤1 工作块）

1. core `passive.ts` 豁免实现 + 三类单测 + 全量回归绿。
2. replay 回归脚本（读 P2 tool-log 重放新栈；零模型调用）。
3. 真跑 ≤3 run（p2 runner 现役）。
4. 结果落档 `tools/experiments/ve-bench/p2/results/p3-<stamp>/` + 判定记录（并入 P2 stage report 附录）。
5. 文档义务：state.md / 全阶段计划状态行 / context README / glossary。

## 6. 非目标（显式排除）

- P2 任何数据与判定的重写；全量重测；新任务面构造。
- always-on 任何形式复活；L4；SEARCH/Branch Search 接线。
- 发布工程本身（四阶段内容；本批只出"发布候选资格"判定）。

## 7. Not verified（如实随档）

- ≤3 run 证明"该失败模式已修 + 能力未破坏"，**不证明**"健康路径普遍零打扰"——后者靠 P2 实测数据 + 本批回归拼接，证据强度低于全量重测。
- gpt 真跑用补测口径（prompt 含派发者确认行 + COMPLETION_LINE 指引），与 P2 主批口径差异随档。
- S1 豁免的理论残余风险：模型对完成调用报错"视而不见"时不再被单发提醒——由 SIG-2 重复失败签名兜底（同签名 ≥3 仍触发）；该兜底需恶意构造才能真跑验证，本批不含，记为已知残余风险。
