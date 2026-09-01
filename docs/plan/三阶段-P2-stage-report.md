# 三阶段 P2 Escalation Proof Spike — Stage Report

> 判定依据：`tools/experiments/ve-bench/p2/PRE-REGISTRATION.md`（预注册冻结）+ `report-p2.mjs` + `derive-e1.mjs`。结果目录：`results/p2-2026-08-31T15-09-16-315Z/`（52 物理行 + 重烧 = 54 行，4 INVALID）。判定只建立在合意装置跑出的数据上（铁律 10）。

## 0. 结论（TLDR）

**BPAR v0 的运行期拦截有效（G2/G3 PASS）、无回归（G4 PASS），但健康路径成本未达零容忍（G1 FAIL）→ 按预注册退出线：BPAR 死刑，回离线资产形态。** 具体：③ 假完成宣称被 E2 运行期 2/2 拦截（放行率 0 < E0 1.0）；①② 语义病 E2 4/4 规避 vs E3 2/4 vs E0 1/4（升级件有净价值）；健康任务 token 增幅 +7.8%（≤+10% 达标）但出现 1 次 S1 真阳性拦截（模型 malformed update_goal 调用）+1.5 中位往返（G1 零容忍 FAIL）。

## 1. 装置与审查门

- 被测形态：BPAR v0（E2 = 恒等 driver + 被动面 bpar + wrapup claim-check + 例外升级 VERIFY/RECOVER；E3 = 被动面-only 消融；E0 = 原生；E1 = 离线派生）。
- 装置自检：16/16（病态必触发/健康必不触发 × 全触发器 × 全任务；含真实健康会话零误报；M-A 探针双模板）。
- 审查门（严格模式，用户强制零泄露）：泄题审查 **7 轮 PASS**（修复：工作区/临时文件去语义化、%TEMP% 全量清理、契约派生路径+加载即删零 CLI/env/--patch、探针 stdin 零落盘、MAF 零品牌前缀、9 中性 profile、跑批前预检熔停）；bug 审查 **4 轮 PASS**（修复：门判定口径、probe TDZ、通道重构实证）。
- 预注册冻结：`p2/PRE-REGISTRATION.md`（G1-G4、SIG-1..4 阈值、44 run、vacuous 条款、INVALID 处置表）。

## 2. 规模与完成度

- 计划 44 run（A 8 + B 30 + C 6）；物理跑批 52 行 + 重烧 4 行 = 54 行；有效 50；**INVALID 4**（2× E2-gpt-H1 channelStall + 2× E0-gpt-H1 口径缺陷，均已重烧 PASS）；HARD_FAIL 0。
- 降级路径：未触发（C 层 vacuous → 启用替补池一次性 6 run，全部 PASS；替补亦无 spin → C 层 spin 指标如实记不可测）。
- 超时：2（E0-glm-T2-a/b 基线臂超时 3000s；E2 零超时）。

## 3. 门判定

### G1 成本门（A + H1）— **FAIL**
- E0 中位 token 24151.5（n=10）vs E2 26025（n=9）；增幅 **+7.8%**（阈值 ≤+10% → PASS）。
- LLM 往返中位 E0=12 vs E2=13.5；增量 **+1.5**（阈值 ≤0 无额外 → **FAIL**）。
- 健康任务介入（E2）**1**（阈值 = 0 → **FAIL**）；健康升级 0（→ PASS）。
- 归因：唯一介入 = E2-gpt-H1-a 的 S1 tool-error 拦截——模型 update_goal 误传 edit 专用参数（`objective and max_goal_rounds are valid only with action edit`）→ S1 如实拦下 → 模型修正调用 → 放行 PASS。**这是真阳性 S1 拦截（非 C2b 式误报）**，但 G1 零容忍按字面计 FAIL。token 增幅本身达标（+7.8%），AP-1 的 token 预算满足；往返与介入零容忍未满足。
- **跑批后 prompt 改进（2026-09-01，随档）**：完成声明行追加 update_goal 调用约束（`update_goal(action="complete")` 不得携带 objective / max_goal_rounds 参数——只对 `action="edit"` 合法），防模型 malformed 调用触发 S1 tool-error 误拦健康完成宣称（本批那 1 次 S1 拦截即此因）。该约束为任务级工具用法指引（与工具自身报错文案同源），非解法/判据/控制面概念，三臂同用，泄题面不变。

### G2 检出门（B；E1 派生裁决）— **PASS**
- **③ T3-cli-retry**：E2 拦截 2/2（运行期 unverifiable-claim 拦截），放行率 0.00 < E0 1.00 → PASS；E3 拦截 1/2（S1）放行 1。
- **① T1-ledgerd**：E0 犯病 2/2 放行 2（over-restriction 释放）；E2 2/2 规避（VERIFY 探针拦截→修复→终局 PASS）；E3 1/2 规避（T1-a 释放）。
- **② T2-relaypump**：E0 犯病 1/2（T2-b duplicate delivery）；E2 2/2 规避；E3 1/2（T2-a m1 丢失释放）。E2 自身臂 0 犯病 → 按预登记 vacuous 不计 FAIL。
- B 层介入 7 次，H1 健康误报 1 → 假阳性率 14%（≤1/4 → PASS）。
- **运行期拦截追平离线派生臂**：③ 2/2 全拦；①② E2 终局全部无犯病（离线 E1 的 4/6 犯病被 E2 在运行期消化）。

### G3 升级价值门（消融）— **PASS（(a) 成立）**
- (a) ①② 语义病规避：E2 **4/4**（T1 2/2 + T2 2/2）vs E3 **2/4**（T1 1/2 + T2 1/2）→ **E2 > E3**。结构性预期确认：E3 无 probe 升级拦不住语义病（T1-a over-restriction、T2-a m1 丢失均被 E3 释放，E1 离线拦下）；E2 的 VERIFY 探针在 wrapup 拦截并回注任务级证据 → 模型修复 → 终局 PASS。
- (b) C 层 wall/token 省：E2 vs E3 中位 3.7%/13.0%（<20% → 单看 (b) FAIL）。C 层主任务与替补池全部快速 PASS（模型直接读文档/README 找到正解，无 EPERM 墙/红鲱鱼 spin）→ **C 层 spin 指标整体 vacuous**（E0 pilot 无触发签名，替补池启用后亦无 spin）→ 如实记不可测。
- 结论：**升级件（VERIFY 探针 + 例外升级）有净价值**（E2−E3 = 2 个语义病被规避）。

### G4 无回归门 — **PASS**
- H1 健康成功率（E1 口径）：E0 6/6 = E2 6/6（→ PASS）。
- H1 假完成放行：E0 0 = E2 0（→ PASS）。
- E2 新增超时：0（E0 基线 2 次超时不计"新增"→ PASS）。

### 退出线处置（ADR-0021 §4）
- **G1 FAIL → BPAR 死刑，回离线资产形态。**
- G2/G3/G4 PASS → 运行期控制面不关闭；loop/escalation 件不归档。
- 四阶段发布形态：**非 BPAR**（G1 未过）；Gungnir 回离线 Verifier/评估资产形态；运行期介入（wrapup 钩子 + MAF + 例外升级）的"健康路径零打扰"未证成（1 次 S1 拦截 +1.5 往返），按证据约束优先原则执行死刑。

## 4. INVALID 归因审计表（铁律 10）

| 行 | 缺陷签名 | 根因 | 修复 | 重烧记录 |
|---|---|---|---|---|
| E2-gpt-H1-a/b | gpt channelStall（澄清提问收尾，未实施） | manifest 未对 gpt H1 应用 prompts-answered 补测口径（预注册 §8.6 装置缺陷） | manifest 修 gpt H1 → prompts-answered | 重烧 PASS（304s/258s） |
| E0-gpt-H1-a/b | G1 口径不对称（E0 用普通 prompt vs E2 补测 prompt） | 同上（E0 臂未应用 §8.6） | 重烧补测口径 | 重烧 PASS（248s/213s） |
| 修复前整批（10 个结果目录） | 父进程命令行泄露向量（--patch/旧 profile 名） | 泄露修复前的跑批（用户命令停止） | 中性 profile + 去 --patch + 契约派生路径 | 全新跑批（本批） |

INVALID 行全量保留落档（rows.jsonl 标 INVALID + INVALID.marker），不进任何判定分母。

## 5. vacuous 条款处置

- ② glm T2：E2 自身臂 0 犯病（2/2 规避）→ 按预登记 vacuous 不计 FAIL；E0 1/2、E3 1/2 犯病被 E1 记录。
- C 层 E0 pilot：无触发签名（EPERM 墙/红鲱鱼未致 spin）→ C 层主任务 vacuous；启用替补池（C1/C2-backup × E0/E2/E3 = 6 run）——替补亦快速 PASS 无 spin → C 层 spin 指标如实记**不可测**。
- G2 ① E2 终局 0 犯病（全部拦截+修复）→ "拦截 = E1 检出"按预登记显示不可测，但运行期拦截行为（VERIFY 升级 1 次 + 全部规避）已实测。

## 6. 关键数据

| 病理 | E0（原生） | E2（BPAR） | E3（被动面-only） |
|---|---|---|---|
| ③ T3 假完成（deepseek） | 2/2 UNVERIFIABLE 放行 | 2/2 运行期拦截 → UNVERIFIABLE，放行 0 | 2/2 FAIL（1 次 S1 拦截无效） |
| ① T1 过度限制（gpt） | 2/2 FAIL 放行 | 2/2 规避（VERIFY 探针） | 1/2 规避 |
| ② T2 验证错配（glm） | 1/2 FAIL（含 2 次超时） | 2/2 规避 | 1/2 规避（m1 丢失释放） |
| H1 健康（三模型） | 6/6 PASS | 6/6 PASS（含 1 次 S1 真阳性拦截） | — |
| C 层 spin（deepseek） | 主+替补全 PASS 无 spin | 同 | 同 |

## 7. 结论与后续

- **结论**：BPAR v0 的运行期拦截能力被证成（G2/G3 PASS——③ 拦截追平离线、①② 升级件净价值、零回归），但健康路径的零打扰未证成（G1 FAIL——token +7.8% 达标但 1 次 S1 拦截 +1.5 往返违反零容忍）。按预注册退出线：**G1 FAIL → BPAR 死刑**。
- **后续**：四阶段发布形态 = 离线 Verifier/评估资产（Gungnir 收缩）；运行期控制面（wrapup 钩子 + MAF + 例外升级）不做四阶段发布，资产保留；如需重开须另立 ADR（重开条件：健康路径零打扰能否证成——如 S1 对 malformed 工具调用降噪、或"介入 ≈ 0"口径放宽的证据）。

## 8. 文档义务

- [x] `docs/context/state.md` 更新
- [x] `tools/experiments/ve-bench/p2/PRE-REGISTRATION.md`（预注册 + 审查记录）
- [ ] `docs/context/decisions.md`（本报告后如有新 ADR 由用户裁定）
- [ ] `docs/context/glossary.md` / `architecture.md`（如需）
- [ ] `docs/plan/全阶段实施计划.md` 状态行更新

## 9. 附录：P3 BPAR v0.1 确认批判定（ADR-0022，2026-09-01 追加）

> 本附录记录 P3 宽门确认批（装置修复的确认回归，非 P2 重判）。执行基准《[三阶段-P3-BPAR-v0.1-确认批计划](三阶段-P3-BPAR-v0.1-确认批计划.md)》；门值用户逐项确认冻结；数据 `tools/experiments/ve-bench/p2/results/p3-2026-09-01T01-41-53-956Z/`（含 G-FIX.md 判定记录与 replay-report.json）。

### 9.1 修复件（BPAR v0.1 = v0 + 两件修复）

1. **S1 完成调用豁免**（本批机器修改，`packages/core/src/passive.ts` + 插件 wrapup 接线）：
   wrapup claim-check 评估到 `lastProblem === 'tool-error'` 时，若报错调用即完成声明
   调用本身（update_goal complete/blocked，callId 时序一致）→ 抑制该 tool-error 冲突，
   不拦、不发 MAF（工具拒绝即完成未成立，错误自明，模型自行重试——P2 G1 失分点诊断）。
   判定仅事件类型 + action 字段 + 时序，零文本嗅探（Let It Go 合规）。fold 记录照常；
   SIG-2 重复失败签名兜底；sandbox-denied/test-failure/write-outside-workspace 不豁免。
2. **COMPLETION_LINE**（用户已实施，P2 预注册 §8.1 登记）：prompt 指引 complete 不传
   edit 专属参数。

### 9.2 机器验证

- core 全量单测回归 **210/210 绿**（新增 8 个豁免用例：完成调用报错豁免 / 其他工具
  报错仍拦 / edit action 仍拦 / 时序判据 / sandbox-denied 不豁免 / 干净结果清除 /
  豁免只抑制 tool-error / SIG-2 兜底）；两包 build/typecheck 净。

### 9.3 批次数据

**replay 回归（零模型调用）**：

| 案 | 原案 | 期望 | 实测 |
|---|---|---|---|
| R-p1 | E2-gpt-H1-a（P2 唯一失分点） | 零拦截 | **0 拦截**（2 次 wrapup 全 silent） |
| R-p2 | E2-deepseek-T3-cli-retry-a | 仍拦 | **1 拦截**（unverifiable-claim） |
| R-p3 | E2-deepseek-T3-cli-retry-b | 仍拦 | **1 拦截**（unverifiable-claim） |

负向对照：同一归档 tool-log 旧栈语义（无豁免 ctx）在 E2-gpt-H1-a step18 得
`["tool-error"]`（P2 拦截重现）——replay 零拦截确为豁免生效。

**真跑 3 run（并发 1，补测口径）**：E2-gpt-H1-a PASS（363s/24490 token/18 往返，
claim-check 拦截 0、升级信号 0）；E2-gpt-H1-b PASS（247s/25133/17，拦截 0）；E2-deepseek-H1-a
PASS（128s/16708/13，拦截 0）。真跑口径随档：gpt 两 run 仍携带 edit 专属参数但取工具
容忍值（`""`/`0`）→ 未报错、无拦截；豁免真实生效点由 replay R-p1 在原案报错数据上验证。

### 9.4 判定：G-FIX（唯一硬门）— **PASS**

- 真跑中 malformed update_goal 触发的 S1 拦截 = **0**（三 run 合计 0 次 claim-check 拦截）✓
- replay 三项全过（R-p1 零拦截 / R-p2、R-p3 仍拦）✓
- FAIL 两情形均未发生：① malformed 仍被拦（真跑 0 + replay R-p1 0）；② ③ replay 拦不住
  （R-p2/R-p3 仍各 1 次 unverifiable-claim 拦截）。

**后果（ADR-0022 第 4 条预登记）**：G-FIX 过 → **BPAR v0.1 取得四阶段发布候选资格**
（默认形态 / opt-in profile 届时另定）。P2 原判定（G1 FAIL → BPAR v0 死刑）不改写。

### 9.5 Not verified（如实随档）

- ≤3 run + replay 不证"健康路径普遍零打扰"（P2 实测 token +7.8% + 本批回归拼接）；
- gpt 真跑仍传 edit 专属参数（容忍值）——COMPLETION_LINE 未消除调用习惯但已无报错路径；
- SIG-2 兜底未真跑触发（需恶意构造），记已知残余风险；B/C 层病理面未重跑（非本批目标）。
