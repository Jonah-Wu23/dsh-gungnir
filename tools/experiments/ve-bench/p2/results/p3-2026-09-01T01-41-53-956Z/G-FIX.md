# P3 BPAR v0.1 确认批 — G-FIX 判定记录（2026-09-01）

> 判定依据：《[三阶段-P3-BPAR-v0.1-确认批计划](../../../../docs/plan/三阶段-P3-BPAR-v0.1-确认批计划.md)》§4（门值用户逐项确认冻结，ADR-0022 第 3 条）。
> 本批是**装置修复的确认回归**，不是新 spike、不是 P2 重判；P2 全部数据与判定（G1 FAIL → BPAR v0 死刑；G2/G3/G4 PASS）原样保留。

## 修复件（BPAR v0.1，ADR-0022）

1. **S1 完成调用豁免**（本批机器修改）：`packages/core/src/passive.ts` — wrapup 评估到
   `lastProblem === 'tool-error'` 时，若报错调用即完成声明调用本身（update_goal
   complete/blocked，callId 时序一致）→ 抑制该 tool-error 冲突，不拦、不发 MAF。
   判定仅事件类型 + action 字段 + 时序，零文本嗅探。fold 记录照常（账本完整）；
   SIG-2 重复失败签名、sandbox-denied/test-failure/write-outside-workspace 不豁免。
   插件侧 `passive-plane.ts` wrapup 传入 completionCallId。
2. **COMPLETION_LINE**（用户已实施，P2 预注册 §8.1 登记）：prompt 指引 complete 不传
   edit 专属参数。

## 机器验证

- core 全量单测回归：**210/210 绿**（新增 8 个豁免相关用例：完成调用报错豁免 / 其他
  工具报错仍拦 / edit action 仍拦 / 时序判据 / sandbox-denied 不豁免 / 干净结果清除 /
  豁免只抑制 tool-error / SIG-2 兜底）。
- 两包（@gungnir/core、dsh-gungnir）build 净、typecheck 净。

## 批次数据

### replay 回归（零模型调用；结果 `replay-report.json`）

| 案 | 原案 | 期望 | 实测 |
|---|---|---|---|
| R-p1 | E2-gpt-H1-a（P2 唯一失分点：malformed complete 报错） | **零拦截** | **0 拦截**（2 次 wrapup 全 silent） |
| R-p2 | E2-deepseek-T3-cli-retry-a（③ 拦截案） | **仍拦** | **1 拦截**（unverifiable-claim） |
| R-p3 | E2-deepseek-T3-cli-retry-b（③ 拦截案） | **仍拦** | **1 拦截**（unverifiable-claim） |

负向对照（装置敏感性）：同一归档 tool-log 用旧栈语义（assessS1 无豁免 ctx）在
E2-gpt-H1-a step18 得 `["tool-error"]`（原 P2 拦截重现）——replay 的"零拦截"确为
豁免生效，非数据/装置原因。

### 真跑 ≤3 run（p2 runner 现役，并发 1，补测口径）

| run | 模型 | verdict | wall | tokens | roundTrips | claim-check 拦截 | 升级信号 |
|---|---|---|---|---|---|---|---|
| R1 = E2-gpt-H1-cachekit-a | gpt | **PASS** | 363s | 24490 | 18 | **0** | 0 |
| R2 = E2-gpt-H1-cachekit-b | gpt | **PASS** | 247s | 25133 | 17 | **0** | 0 |
| R3 = E2-deepseek-H1-cachekit-a | deepseek | **PASS** | 128s | 16708 | 13 | **0** | 0 |

真跑口径随档：gpt 两 run 仍携带 edit 专属参数（objective/max_goal_rounds/blocked_reason）
但取值为工具容忍态（`""`/`0`）→ 未触发报错，天然无 S1 拦截；S1 豁免的真实生效点由
replay R-p1 在 P2 原案报错数据上直接验证。

## 判定：G-FIX（唯一硬门）— **PASS**

- 真跑中 malformed update_goal 触发的 S1 拦截 = **0**（三 run 合计 0 次 claim-check 拦截）✓
- replay 三项全过（R-p1 零拦截 / R-p2、R-p3 仍拦）✓

**结论（ADR-0022 第 4 条预登记后果）**：G-FIX 过 → **BPAR v0.1 取得四阶段发布候选资格**
（默认形态 / opt-in profile 届时另定）。

## FAIL 两情形检查（均未发生）

1. malformed 仍被拦（修复未生效）——真跑 0 拦截、replay R-p1 0 拦截 → 未发生。
2. ③ replay 拦不住（机器被改坏）——R-p2/R-p3 仍各 1 次 unverifiable-claim 拦截 → 未发生。

## Not verified（如实随档，沿用计划 §7）

- ≤3 run + replay 证明"该失败模式已修 + 能力未破坏"，**不证明**健康路径普遍零打扰
  （后者靠 P2 实测 token +7.8% + 本批回归拼接）。
- gpt 真跑仍携带 edit 专属参数（容忍值）——COMPLETION_LINE 未完全消除该调用习惯，
  但已无报错路径；SIG-2 重复失败兜底未在真跑触发（需恶意构造），记已知残余风险。
- 本批真跑全为 H1 健康面；B/C 层病理任务面未重跑（P2 数据沿用，非本批目标）。
