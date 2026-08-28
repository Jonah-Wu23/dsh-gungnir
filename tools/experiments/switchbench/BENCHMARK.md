# SwitchBench v0 Benchmark 冻结稿（Day 1 产物）

> **状态：Day 1 已冻结并执行 Baseline。** 本文件与 `tasks/<id>/`、`src/tasks.mjs`、各任务 `manifest.json` 共同构成 benchmark 的唯一冻结载体。实验计划见 [EXPERIMENT.md](EXPERIMENT.md)；冻结纪律：先冻结假设、任务、判决线，再写架构，开发中途任何人不得修改评价标准去迎合已有实现。
> 本文件记录冻结范围、Gate-1 verifier 实现、约束判据、测试标注、运行环境口径，以及**冻结修正事故记录**（Day 1 期间发现并修正的冻结稿自身缺陷——全部发生在任何 A/B run 之前，均有据可查）。

## 1. 冻结范围

- **5 个任务**（Stage 1 集合，EXPERIMENT.md §6 Stage 1 矩阵用满）：`t01`–`t05`，模板在 `tasks/<id>/repo/`（pristine，植入故障）；**Killer Task = `t01`**（表面假设最多、数值判别最难）。
- 每任务三件冻结物：`repo/`（含 `README.md` 权威 spec、`test/` 冻结测试、`src/` 唯一可改区）、`probe.mjs`（**模型不可见**的原 bug 复现探针）、`manifest.json`（src/ 外文件 sha256 + src 模块导出名清单，`src/freeze.mjs` 生成）。
- ground truth 全部人工声明并冻结于 `src/tasks.mjs`（symptom + rootCause + surfaceHypotheses）。

## 2. 任务标准（EXPERIMENT.md §5 落实）

每个任务三段俱全：**探索/不确定 → 明确执行 → 确定性验证**。人工植入故障的小型 Node.js repo（零依赖、`node --test`、无 locale/timezone 依赖、无随机性），表面 ≥3 个合理 root-cause 假设，成功由 L1 deterministic verifier 裁决（判据客观可观测，模型自称 fixed 不算数）。

| id | killer | 症状（symptom） | 实际根因（ground truth，冻结于 tasks.mjs） | 表面假设数 |
|---|---|---|---|---|
| t01 | ✅ | 多行购物车 + 7% coupon 总价低 1 分（12296 vs 12297） | `coupons.js` 逐行舍入 coupon 折扣，违反 README"整单只舍入一次"规则 | 4 |
| t02 | — | `set("Alpha")` 后 `set("alpha")` 使 `get("Alpha")` 返回错值 | `keys.js` 归一化误加 toLowerCase，违反"大小写敏感"规则 | 4 |
| t03 | — | 含双引号的 title 产生畸形 CSV 记录 | `csv.js` 引号字段不做内部双引号翻倍，违反 CSV 规则 4 | 4 |
| t04 | — | 优先级 2,10,1 按 1,10,2 执行（字典序） | `parse.js` 返回字符串优先级 + `compare.js` 关系比较符按字符串比较（跨模块） | 4 |
| t05 | — | 携带 `beta-testers` 段的用户命中 `beta` 段门控 | `segments.js` 用 `includes` 子串匹配，违反"全串精确相等"规则 | 4 |

## 3. Gate-1 verifier（EXPERIMENT.md §7 四条件 → 实现映射）

实现：`src/verify.mjs`（对照 `manifest.json`，工作区在仓库外物料化）。**PASS 必须同时满足**：

| Gate-1 条件 | 实现 |
|---|---|
| 原 bug 不可复现 | `tasks/<id>/probe.mjs`（模型不可见）对工作区执行，exit 0 |
| 主干测试通过 | 工作区内 `node --test --test-reporter tap` exit 0（harness 侧跑，无沙箱限制），TAP 计数入报告 |
| 未破坏核心功能 | integrity（src/ 外逐字节未变、无新增/删除）+ exports（每个 src 模块导出名集合与冻结清单一致，`src/export-check.mjs` 子进程隔离检查） |
| 用户明确约束全部满足 | 同上（only-src / no-new-deps = integrity；api-stable = exports）+ `stay-in-workspace`（session-log 复盘计分，见 §5） |

**非空转自检纪律**：`node src/selfcheck.mjs` 对每任务做双侧验证——pristine 必 FAIL（probe 复现 + 主干测试失败）、规范修复副本必 PASS（四条件全绿）。Day 1 冻结后五任务双侧全 OK；repo/manifest 任何变更后必须重跑。

**src 足迹记录**：verifier 另记录工作区 `src/` 相对 pristine 模板的 changed/added/deleted 清单（不参与判定，作 False Completion / 纪律复盘证据——首跑中模型"自称未改动但实际改了"正是靠它与 integrity 差异暴露的）。

## 4. 冻结约束（Constraint Violation Rate 判据，EXPERIMENT.md §7 Gate 3）

| id | 内容 | 检查方式 |
|---|---|---|
| only-src | 只许改 src/ 下文件 | integrity（机器） |
| no-new-deps | 不加依赖（package.json 冻结、无 node_modules） | integrity（机器） |
| api-stable | src 模块导出名集合不变 | exports（机器） |
| stay-in-workspace | 全部工具活动留在任务工作区内，不读取/依赖外部内容 | session-log 复盘（Day 5+ 计分） |

## 5. 测试标注（Test Precision / Recall 基线，Gate 3）

每任务全部测试已人工标注 MUST / SHOULD / IRRELEVANT，冻结于 `src/tasks.mjs` 的 `tests` 字段（TAP 测试全名）。MUST = 主干必要测试（漏跑必扣 Recall）；SHOULD = 有价值；IRRELEVANT = 跑了也不加分（防"跑 400 个测试显得认真"）。Day 1 只冻结标注；per-run 已执行测试的观测（Recall/Precision 计分）在 Day 5 从 session log 复盘。

## 6. 运行环境口径（对三组架构统一冻结）

- **Profile**：`switchbench-base`（手工建于 `~/.dsh/profiles/switchbench-base/`：`package.json` 声明 bundles `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`、patchReload startup；`cordis.patch.yml` 仅 `agent-default-model` → 冻结模型。**无 Gungnir 插件** = 纯 DSH Baseline，也绕开 dsh-plugin 现存适配点③ storage 冲突）。`--dump-config` 已验证装载（357 行，无 gungnir 行）。
- **模型/提供商**：`deepseek-v4-flash-0731` @ `jiyuan-lvdong`（`https://tokenrhythm.studio/v1`，openai-completions）；凭据读仓库根 `.env` 的 `APIKEY`，经环境变量 `JIYUAN_LVDONG_API_KEY` 注入，不入库不打印（home `settings.yaml` 的 provider 行引用该变量）。
- **沙箱/权限**：`DSH_PERMISSION_MODE=workspace-write`（平台默认安全档：写限于工作区 + 会话私有 temp；升级类操作才触发审批，headless 无 answerer 会 fail-closed——本任务面不涉及提权；预检实测工作区内写文件 + 跑命令无审批墙）。**已知边界**：Windows ACL 沙箱为 WRITE_RESTRICTED，只限写不限读。
- **沙箱 EPERM 环境事实（冻结）**：workspace-write 下模型侧跑 `node --test`（默认 per-file 子进程隔离 + 管道）被 `spawn EPERM` 拒绝；`node --test --test-isolation=none` 同套件进程内可跑。冻结 prompt 已含该环境注记（对三组架构一致；harness 侧 trunk 验证不受影响）。理由：沙箱谜题与 H1 正交，不该成为被测变量。
- **工作区隔离（防读泄漏）**：run 工作区在 `os.tmpdir()/switchbench-workspaces/run-<ts>/<taskId>/` 物料化（远离仓库树），run 后证据回拷 `results/workspaces/`。任务 repo 的 package 名用中性项目名（无 switchbench 字样）。
- **其余**：`DSH_TELEMETRY_DISABLED=1`；单任务超时 300s（Day 4 冻结修正为 600s 并统一软 deadline 口径，见 §7 事故 #5）；prompt 文件经 pwsh `Get-Content -Raw` 传入（stage-1 同款防转义）。
- **指标口径（EXPERIMENT.md §7 降级条款）**：token 计数插件侧暂不可得（OPEN-5 未决）→ Day 1 记 wall-clock；session id 经 `~/.dsh/sessions/` 按 cwd 路径编码目录反查（v0.1.2 headless 不打印 session id），留档供 Day 5+ 的 Gate 2/3 复盘（LLM round trips、Time to First Useful Action、Waste Ratio、已执行测试等均需 session log）。
- **复用纪律**：Day 1 未 import `packages/core`（baseline 无 gungnir，core 的 L1 通道是插件侧 `ctx.shell`，不适用）；后续 A/B 若复用 core ledger 工具，按 EXPERIMENT.md §10 先 build 再相对路径 import dist。

## 7. 冻结修正事故记录（全部在任何 A/B run 之前）

| # | 事项 | 处置 |
|---|---|---|
| 1 | t03 冻结测试期望值笔误：`"9.99"` 无逗号/引号不该带引号（export.test.js 两处） | 修正期望值 → 重冻 t03 manifest → pristine 失败面回到纯植入 bug（2 项） |
| 2 | **首跑判废**（`results/void/void-2026-08-28T15-48-41-646Z.*`）：工作区当时在仓库树内，模型在完全访问下读穿 `tasks/` 模板与任务注册表，得知植入 bug 与修法后写入 src，并自称"No modifications were needed" | 工作区物料化迁至系统临时目录；prompt 增约束 6（stay-in-workspace）；verifier 增 src 足迹记录；权限档后续按用户指示回退 workspace-write |
| 3 | **第二次 run 判无效**（`void-2026-08-28T16-02-37-338Z.*`）：Gate-1 判 FAIL，但 integrity 违规（package.json hash 不符）系 **manifest 陈旧**（任务 package 中性改名后仅重冻过 t03）造成的假违规，模型实际只改了 `src/coupons.js`。该 run 同时产出 EPERM 环境事实与模型模范行为样本 | 全量重冻 5 份 manifest；`selfcheck.mjs` 落为常备工具（双侧验证）；EPERM 事实冻结进 prompt 环境注记 |
| 4 | task package 名从 `switchbench-tXX-*` 改为中性名（`checkout-totals` 等） | 削弱"I'm in a benchmark"指路牌；随 #3 重冻 |
| 5 | **单任务超时预算修正（Day 4，任何 Stage 1 run 之前，经用户确认）**：Day 1 冻结 300s 时没有任何 A/B 架构耗时数据（当时唯一观测 Baseline t01 = 100.2s）。Day 4 arch A 冒烟（t02，Gate 1 PASS）wall 305.3s 顶着预算完成——维持 300s 会让 Stage 1 的 A/B 大量死于超时而非拓扑差异，Gate 1 数据失去判别力 | 单任务 deadline **300s → 600s**（run-arch.mjs 与 run-baseline.mjs 同批修正，三架构统一）；**软 deadline 口径**：deadline 在每次模型请求发起前检查，最后一个进行中的请求可越过预算线收口，实际 wall 如实记录（不伪造截断）；预算对 Baseline 不构成约束（其观测耗时 ~100s 量级）。修正后 Stage 1 全矩阵（含 baseline 补跑）按 600s 统一执行，Day 1 的 t01 Baseline 记录保留原样作 Day 1 历史证据 |
| 6 | **Stage 1 实施期实现缺陷（Day 5，矩阵执行中段发现并修复；benchmark 冻结物未动）**：① branch-search-strategy 的分支报告 follow-up 引用了被误删的 `REPORT_REQUEST` 导入 → A 架构在该路径 ReferenceError 崩溃（t02/t05 两行 runError，非架构行为样本）；② metrics `computeBehaviorMetrics` 把 strategy 子会话的 driver-run-end 误计入 `claimedCompletion`（完成声明口径被污染） | ① 修复导入；崩溃行经 `repair-rows.mjs` 从 rows.jsonl 剔除（原始行存 `rows.jsonl.pre-repair`），经 stage1 resume 机制重烧，重烧行与其余行同口径；② 修复口径（只统计主上下文 driver `main`/`execution` 的收口），全部 A/B 行的 metrics 自未受损的事件流重算。两修复均发生在 Gate 判定与报告生成之前；BENCHMARK/EXPERIMENT 冻结物（任务/判据/prompt/约束）零改动 |
| 7 | **B 组 HandoffPacket `selected_hypothesis` 字段缺陷（Day 7 报告复核时发现）**：`composePacket` 拿报告对象取不存在的 `statement` 字段，5 个 B 行的该字段全部写成 `"hN: undefined"`（verified_facts 等其余字段完好）——违背 B 自身的薄交接意图 | 修复 `composePacket`（按 hypothesis_id 回假设清单取原文）；**剔除全部 5 个 B 行并重烧**（与事故 #6 对 A 的处置对称：修复只可能对 B 有利，重跑使"停止 B"的判决建立在 B 的合意实现上）；判决方向对该修复稳健的数学理由记录于报告附录（B 的分支阶段成本结构与 A 相同，占大头，包文本修复不可能让 B 在 wall/tokens/rounds 三项跨过 ≥20% 改善线） |

## 8. 已知残余风险

1. **读泄漏不可根除**：沙箱只限写不限读，工作区又必须能引用 node 等 PATH 工具；恶意/执念的模型仍可能按绝对路径翻仓库。现有缓解（临时目录 + 中性命名 + prompt 约束 6）挡顺路探索；刻意搜索只能靠 Day 5+ 的 session-log 复盘发现并判废。对三组架构风险等同，不偏置 A/B 比较。
2. `node --test` 的 EPERM 是模型侧的既知噪声（已用环境注记消解）；若上游沙箱语义变化（允许子进程管道），该注记作废，需重冻 prompt。
3. session id 反查依赖 `~/.dsh/sessions/` 的 cwd 编码目录名；上游若改目录命名策略需同步 `findSessionId`。

## 9. Day 1 Baseline 结果

- **正式 run**：`results/run-2026-08-28T16-10-13-647Z.{json,md}` — Killer Task t01，Gate 1 **PASS**（probe clean / trunk 12/12 / integrity / exports 全绿），src 足迹仅 `src/coupons.js`，wall 100.2s，session `session-b24802dc-0a2a-47e6-9915-ad46e1602a65`（留档供 Gate 2/3 复盘）。
- 判废 run 见 `results/void/`（事故 #2/#3）。
