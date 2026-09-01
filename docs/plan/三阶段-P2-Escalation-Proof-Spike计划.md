# 三阶段 P2：Escalation Proof Spike 实施详细计划

> **状态：已规划（2026-08-31），跑批前须经预注册冻结 + 审查门双 PASS。**
> 决策依据：**ADR-0021**（实验归因纪律升格铁律 10；BPAR v0 形态定义；escalation 形态第一次也是最后一次审判）。本计划是作废存档《[三阶段-Fast-Path-Escalation-Spike计划](三阶段-Fast-Path-Escalation-Spike计划.md)》的复活重写版——旧计划的信号清单（§4）与 Baseline Failure Set 口径（§5）被吸收，任务面与检出测量结构全部重做（差异见附录 A）。
> 唯一目的：**检验"最贴近三个最初方案（动态 agent loop / 动态工作逻辑 / ultragoal）的形态能否在成本 ≈ 无插件基线的前提下成立"。** 不是发布工程，不是离线资产打包。
> DSH 基线 = v0.1.2-alpha.1 源码构建（ADR-0011）；接口事实以 `docs/context/dsh-interface.md` 为准。

---

## 1. 背景与唯一核心问题

四轮既往实验的清算（ADR-0021 证据四分类）：

| 实验 | 对本 spike 的意义 |
|---|---|
| SwitchBench v0（ADR-0013） | 方案 B（物理切换）停投；⑦ Baseline-Preserving 与 Default-to-cheap 原则来源 |
| 二阶段 Adaptive Loop Spike | always-on 协议税 2–3×（结构性，死刑维持）；B3 证明恒等 driver 与原生 17 类事件词汇一致 |
| 三阶段 P1 Passive Proof Spike（ADR-0018） | C2a 被动面成本证立（+0.4% token、零往返、零介入）；C2b 假阳性 = 装置缺陷（按铁律 10 改记 INVALID）；检出率 vacuous（分母为零） |
| H-VE M4/M5 | **治愈 vacuous**：实测犯病点位 = ③ deepseek 2/2、① gpt 补测 2/2、② glm 1/2；验过的离线法官可作检出 ceiling |

**唯一核心问题**：

> BPAR v0（一次性契约 + 被动面 + 恒等 driver + 例外升级）能否做到：健康任务成本 ≈ 原生（AP-1），且在模型**已知会犯病**的任务面上，运行期拦截率追平离线法官（ceiling），并证明"例外升级"组件有净价值？

## 2. 被测形态：BPAR v0（Baseline-Preserving Adaptive Runtime）

三方案承重件映射（ADR-0021 第 2 条）：

| 最初方案 | 承重件（进 spike） | 砍除部分（死刑维持） | 成本实测背书 |
|---|---|---|---|
| ultragoal | 一次性 L1 派发契约（`packages/core/src/contract.ts` 现役）+ harness 侧 Evidence/Verifier/Reconciler | 逐轮 spec/commit/report 协议仪式 | 契约由派发供给 = 0 额外往返 |
| 动态工作逻辑 | 被动面：S1 通用不变量 + harness 模板化 S2 命令 + wrapup 结构钩子 + MAF 最小介入反馈 | agent 自写 shell 验证命令（C2b 炸雷源） | C2a 实测 +0.4% token |
| 动态 agent loop | 恒等 driver（AdaptiveLoopAgent，EXECUTE 恒等）进 spike profile 默认配置 + 证据触发例外升级（VERIFY/RECOVER） | 每轮 Mode Router；SEARCH/Branch Search 不接线 | ADR-0014 B3 恒等等价 |

纪律边界：hysteresis 沿用 ADR-0015 冻结值（dwell/cooldown/单 turn 预算 4，每 session 升级预算 ≤2，预注册冻结）；单实例纪律（铁律 9）——session 生命周期内 driver 实例稳定，升级 = 实例内 Loop Strategy 切换；Let It Go——全部触发信号为 fold/ledger 派生的计数性事实，严禁关键词/正则嗅探模型文本。

## 3. 对照臂

| 臂 | 形态 | 回答的问题 |
|---|---|---|
| **E0** | 原生 DSH（无 gungnir），交付与 tool-log 全录档 | 基线成本 + 自然犯病率 + 假完成放行率基线 |
| **E1**（派生臂，零模型 run） | 对 E0/E2/E3 录档会后跑 B2 离线供给闭环全量裁决（`tools/ve-supply`，`--tool-log` 通道现役） | 检出 ceiling / ground truth：离线法官的检出率是上界，全臂交付的终局真伪由它裁决 |
| **E2** | BPAR 全形态（恒等 driver + 被动面 + wrapup claim-check + 例外升级） | 本实验主假设 |
| **E3** | 被动面-only（原生 driver + 被动面 + MAF，无升级接线） | 消融臂：E3−E0 = 被动面净效果；**E2−E3 = loop/升级件净效果**（动态 agent loop 承重件的独立审判） |

E1 派生臂是本次"非 vacuous"结构的关键：离线裁决零边际 run 成本（P1 派生 C1 先例），且给所有臂提供同口径 ground truth。

## 4. 任务面（三层，全部冻结物复用 + C 层新建）

### A 层：健康成本门（8 run）

P1 spike 正常任务 4 件（`tools/experiments/spike` 冻结物，三模型均曾正确完成）× deepseek（对照锚，与 C2a 同口径连续）× E0/E2。glm/gpt 的健康成本样本由 B 层 H1 健康 run 兼任（双用途，不重复烧）。

### B 层：病理检出门（30 run，分母 = M4/M5 实测点位）

| 病理 | 任务（冻结物） | 模型（实测犯病率） | 臂 | run |
|---|---|---|---|---|
| ③ 假完成宣称（沙箱盲区） | m4 T3-cli-retry ×2 变体 | deepseek（M4：**2/2**） | E0/E2/E3 | 6 |
| ② 验证错配（三体交互） | m5 T2-relaypump ×2 | glm（M5：1/2，**预期分母 1/2，可能 vacuous，预登记处置**） | E0/E2/E3 | 6 |
| ① 迎合/过度限制 | m5 T1-ledgerd ×2 | gpt（M5 补测：**2/2**；prompts-answered 通道，口径差异随档） | E0/E2/E3 | 6 |
| 健康对照 | m5 H1-cachekit ×2 × 三模型 | 全部（M4/M5：0 误杀） | E0/E2 | 12 |

任务、契约（含 unverifiableCriteria 与 M-A 模板供给）、prompts 全部复用 M4/M5 已冻结且自检通过的资产，零新任务工程。gpt 走补测口径（prompt 含派发者确认行），跨批比较随档。

### C 层：升级回本门（6 run，Baseline Failure Set lite）

新建 2 件 + 替补 2 件（唯一的新任务工程），S1 签名结构性可触发、双侧可自检：

- **C-1 环境墙空转**：工作区内 `node --test` 必 EPERM（已知沙箱事实），等价路径（`--test-isolation=none`）只写在该子目录 README；预期 baseline 多步空转后才发现（Stage-2 post-mortem 实证过 EPERM 墙消化成本差异）。触发签名 = 同 errorSignature 连续 ≥3。
- **C-2 误假设空转**：任务内置红鲱鱼（显眼但无关的报错日志），正解在别处；咬住红鲱鱼表现为重复读取相同未变化文件。触发签名 = 同文件无变化重读 ≥3 次。

臂 E0/E2/E3。**E0 兼任 baseline pilot**：E0 全程未出现可触发异常签名 → 该行记 vacuous（不归罪形态），启用替补池（冻结 2 件，一次性）；替补再 vacuous → C 层如实记不可测，不强行续命。

### 规模汇总

正式批 **44 run**（A 8 + B 30 + C 6）+ E1 派生裁决（零模型 run）。降级路径 **32 run**（A 砍至 2 任务、H1 砍至单变体、C 砍至 E0/E2）。并发 2、分臂分模型阶段跑批，沿用 m5 runner（防串守卫 / env 净化 / port 0 / 熔停 / --resume 全现役）。

## 5. 触发器与升级动作（M1 预注册冻结）

| 信号 | 判定来源（全部 fold/ledger 派生） | 动作 |
|---|---|---|
| SIG-1 claim/evidence 冲突 | wrapup 结构事件时契约判据无确定性证据支撑，或被判 FAIL/UNVERIFIABLE | 拦下完成宣称 + MAF；有 M-A 模板供给 → 升级 **VERIFY**（harness 侧跑 probe 再终判） |
| SIG-2 重复失败 | 同 errorSignature 连续 ≥3 | MAF（面向任务事实）；仍不收敛 → **RECOVER**（投影/换档，预算内） |
| SIG-3 无效浪费 | 相同未变化文件重读 ≥3 次 | MAF |
| SIG-4 停滞 | 连续 N 步无新 evidence 产出（N 预注册，建议 8） | MAF |

AP-6：介入反馈只说任务级事实，不暴露控制面内部概念。AP-4：新 evidence 到达即重评受影响判据。

## 6. 指标口径

- 成本：input/output tokens（tokenMeter usage 锚点口径，含 cacheReadTokens，ADR-0014③；不可得时离线 tokenizer 下界估计，同向偏差随档）、LLM round-trips（session log）、wall-clock、wasted steps（中位，二阶段口径）。
- 介入质量：介入次数 / precision / recall（以 E1 离线裁决为 ground truth）；升级次数 / 命中率 / 停留轮次；early-save（首次拦截时刻 vs 会话结束时刻的 wall/token 差）。
- 结果：Verified Goal Completion（E1 裁决口径，假验收 0 纪律）；检出率按病理分类（分母 = E1 判真犯病数）；假完成放行率（E1 判犯病而本臂放行）。

## 7. 判定门（跑批前预注册冻结数值）

- **G1 成本门**（A + H1）：E2 vs E0 中位 token 增幅 ≤ +10%；额外 LLM 往返中位 = 0（契约派发供给时）；**健康任务介入 = 0、健康升级 = 0**（零容忍，C2b 教训）。
- **G2 检出门**（B）：③ E2 运行期拦截率 = E1 检出率（预期 2/2）且 E2 放行率 < E0；① E2 经升级 VERIFY 拦截 = E1（预期 2/2）；② 犯病若发生则 E2 拦截 = E1，若 0 犯病记**不可测不计 FAIL**（预登记 vacuous 条款）；B 层介入假阳性 ≤ 1/4。
- **G3 升级价值门**（消融）：(a) ①② 拦截 E2 > E3（结构性预期：E3 无 probe 升级拦不住语义病）或 (b) C 层 E2 vs E3 wall/token 省 ≥20%。两条皆不成立 → loop 件无净价值。
- **G4 无回归门**：E2 放行 falseCompletion ≤ E0；健康成功率 E2 = E0；零新增超时。

判定规则：n 小不做统计显著性检验，以效应量 + 预注册阈值为准（沿用既有口径）；INVALID 行不进任何分母（铁律 10）。

## 8. 熔断与退出线（ADR-0021 第 4 条）

- 过程熔断（沿用 m5 runner 现役语义）：自检失败 / 审查门 FAIL / 硬异常 → 熔停、修复、重烧受影响行（记 INVALID），不带病跑批。
- **G1 FAIL** → BPAR 死刑，回离线资产形态（证据约束优先于偏好，用户已确认）。
- **G2 FAIL**（运行期拦截不超离线派生臂）→ 运行期控制面**永久关闭**，escalation 资产删除性归档（不再冻存待复活）。
- **G3 FAIL** → loop 件永久归档；被动面 + 契约若 G1/G2/G4 过仍可单独成立（动态工作逻辑 + ultragoal 承重件幸存）。
- **全过** → 四阶段发布形态 = BPAR（发布工程另立计划，不在本 spike 范围）。

## 9. 实验归因纪律操作化（铁律 10 首批执行）

1. 跑批前：装置合意性证明 = 双侧自检（病态必触发 / 健康必不触发，全触发器 × 全任务）+ 独立审查门双 PASS。
2. 跑批中：任何 run 受装置缺陷影响（runner bug / 通道故障 / 命令构造错误 / 判定栈缺陷）→ 记 INVALID，修复后重烧；INVALID 行全量保留落档，永不删除，不进分母。
3. 报告含 **INVALID 归因审计表**：每条 INVALID 的缺陷签名、根因、修复、重烧记录。
4. 判定只建立在合意装置跑出的数据上。

## 10. 里程碑与时间盒（总预算 ≤4.5 工作块）

| 里程碑 | 内容 | 时间盒 | 退出物 |
|---|---|---|---|
| **P2-0 工程前置** | ①S2 harness 模板化命令（D4，ADR-0018 §2 落地）；②wrapup claim-check 运行期化（M-C 逻辑进被动面，契约重评走 AP-4）；③升级接线（被动面事件 → AdaptiveLoopAgent VERIFY/RECOVER 裁决表，core 纯函数全单测；VERIFY = session 内 harness 侧跑 M-A probe + MAF 回注）；④E2/E3 profile + runner --arm 维度扩展；⑤C 层 2+2 任务建造 + 双侧自检 | ≤2 块 | core 新逻辑全单测绿；三臂真实 profile 冒烟各 ≥1 |
| **P2-1 预注册冻结** | 门数值 / 触发器 N 值 / hysteresis 预算 / 规模与降级路径 / vacuous 条款 / INVALID 处置表；任务面清单冻结 | ≤0.5 块 | PRE-REGISTRATION 冻结 |
| **P2-2 审查门 + 跑批** | bug 审查 + 泄题审查双独立子代理 PASS（M5 纪律）→ 44 run（并发 2） | ≤1.5 块 | rows.jsonl + 逐 run 留档 + E1 派生裁决 |
| **P2-3 判定与报告** | 门判定 + INVALID 归因审计表 + stage report + 文档义务 | ≤0.5 块 | 《三阶段-P2-stage-report》 |

时间盒超支 50% 触发范围削减（砍序：C 替补 → C 层 E3 → H1 变体 → A 任务数），不延期。

## 11. 非目标（显式排除）

- always-on 任何形式复活（协议仪式 / 每轮路由）；L4；SEARCH/Branch Search 接线；LLM router。
- router 调优、prompt 减法式续命（铁律 8）；任何 DSH 源码修改；多 goal。
- 发布工程与离线资产打包（四阶段内容，本 spike 只出判定）。
- 重跑 / 重判 Stage 2、P1、M4、M5 任何旧批次。

## 12. 风险与 Not verified（随档义务）

- ② glm 预期分母 1/2，可能 vacuous（预登记处置：如实记，不归罪）。
- gpt B 层走补测口径（prompt 含派发者确认行），与 M5 主批口径差异随档。
- C 层任务由本项目手写（构造者偏差同 M4/M5 随档）；pilot 失败替换纪律见 §4。
- E2 升级接线是新代码，两轮独立 task-verifier 审计纪律沿用（P1 先例）。
- 单 seed、小 n，方差未量化；token 离线估计为下界（同向偏差）。
- 若三模型在 B 层全部不犯病（M4/M5 点位集体失效），G2 整体 vacuous → 如实记"本批不可测"，不视为形态 FAIL，亦不视为 PASS——按铁律 10 精神，这是任务面失效而非形态判决；处置 = 报告如实落档，是否构造更强 bait 另立工作。

## 附录 A：与作废旧计划（Fast-Path/Escalation Spike）的差异

| 维度 | 旧计划（作废，未执行） | 本计划 |
|---|---|---|
| 任务面 | Baseline Failure Set 从未建成（生死前置卡死） | M4/M5 实测犯病点位直接复用（分母已在手）+ C 层轻量构造 |
| 检出测量 | 无对抗分母设计（P1 因此 vacuous） | E1 离线派生臂当 ceiling，结构性非 vacuous |
| 被测形态 | C 组含 Prove 常驻成分 | BPAR v0 零协议仪式（契约一次性供给） |
| 判定归因 | 无（C2b 式装置缺陷曾计入 FAIL） | 铁律 10：INVALID 重烧再判，不进分母 |
| 被吸收部分 | §4 信号清单 → §5 触发器；§5 构造口径 → C 层；§8 门结构 → §7 | — |
