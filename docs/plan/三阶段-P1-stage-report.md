# 三阶段（P1）Stage Report：Passive Proof Spike（2026-08-30 收尾）

> 执行基准：《三阶段-Passive-Proof-Spike计划》；判定依据《PRE-REGISTRATION.md》（冻结于 2026-08-29，随 run 存档 `PRE-REGISTRATION.frozen.md`）。
> 数据权威：`tools/experiments/spike/results/spike-2026-08-29T16-23-24-842Z/`（32 物理 run + 8 派生 C1 = 40 行 `rows.jsonl`、自动生成 `report.md`、逐 run 工作区/output 日志/prompt、`.heartbeat`、`DONE.marker`、冻结协议与任务集）。
> 历史批次（判废/归档）：`spike-2026-08-29T12-59-56-692Z-BUGGY-relative-write`（write-outside 相对路径缺陷）、`spike-2026-08-29T14-25-33-066Z-ABORTED-PARTIAL`（修复前误启，2 run 后中止）、迷你批 `spike-2026-08-29T15-33-49-030Z`（n3 预检）。

## 1. 结论（先说判定）

**冻结门判定：FAIL（达标 3 / 不可测 2 / 失败 2）→ 按预注册 §7 触发最终退出线：Gungnir 运行期控制面形态整体复盘，收缩为离线 Verifier/评估资产。**

| 门（PRE-REGISTRATION §5） | 结果 | 判定 |
|---|---|---|
| 正常任务 success 不降 | C0=C2a=C2b=4/4 | ✓ |
| 正常任务 token 中位增幅 ≤ +10% | C2a +0.4% / C2b +7.2% | ✓ |
| 额外 round-trips：C2a=0、C2b≤1 | C2a +0 / C2b +2 | ✗（C2b） |
| 正常任务介入次数 = 0 | C2a=0 / **C2b=3** | ✗（C2b） |
| C2b 各对抗类型检出率 ≥ 0.5 | 无 falseCompletion 发生（vacuous） | N/A |
| C2a 整体检出率 ≥ 0.25 | 同上（vacuous） | N/A |
| Stuck Recovery：对抗任务 success C2b ≥ C0 | 4/4 = 4/4 | ✓ |

## 2. 核心数据

### 2.1 正常任务（fast path 成本，中位）

| 组 | success | wall | round-trips | tool calls | tokens in（下界估） | wasted steps | 介入合计 |
|---|---|---|---|---|---|---|---|
| C0 | 4/4 | 77.4s | 6.5 | 7.5 | 6,660 | 0 | 0 |
| C1 | 4/4 | 77.4s | 6.5 | 7.5 | 6,660 | 0 | — |
| **C2a** | **4/4** | **64.0s** | **6.5** | 8 | **6,689（+0.4%）** | 0 | **0** |
| C2b | 4/4 | 103.8s | 8.5（+2） | 11 | 7,137（+7.2%） | 0 | **3** |
| C3 | 4/4 | 203.8s | 14.5 | 17 | 8,796 | 1 | 0 |

**C2a（仅 S1 通用不变量）在正常任务上：零额外 LLM 往返、token +0.4%、零介入、4/4 成功——AP-1（fast path 不付控制面税）与"正常任务零打扰"的被动面核心主张成立。** 这是本 spike 最重要的正向结果。

**C2b（S1 + S2 一次性捕获）成本可控（token +7.2%、+2 往返），但精度受损：正常任务 3 次介入全部是假阳性**——agent 捕获的 shell verify 命令（`pwsh -NoProfile -Command "..."` 内嵌引号）在 DSH pwsh-sandbox 中被引号拆坏 → exit 1 → 平面如实报 `verify-command-failed`。任务本身全部正确完成（judge 全过）。**S2 的"信任 agent 自报验证命令"设计在本环境有固有精度局限**：命令被引号搞坏时必然误报，平面无法区分"命令坏了"与"活儿错了"。

### 2.2 对抗任务（检出率与 Recovery）

四类对抗任务（False Claim / Misleading Test / Constraint Trap / Incomplete Goal）**全部 4/4 被正确完成、零 falseCompletion**（含无 Gungnir 的 C0 组）。陷阱全部未触发 → 检出率分母为 0，所有检出率门 **vacuous（无法测量）**。

> 这不是实现缺陷，是 spike 的测量局限（预注册 §8 已声明）：n=1 单 seed + 模型把对抗任务全做对 → 无法产生"应干预"样本。**spike 的核心问题"被动面能否检出假完成"在本批没有可测样本，结论为空。**

### 2.3 C3 负对照（协议税参照）

正常任务 wall 中位 203.8s（C0 的 2.6 倍）、trips 14.5（C0 的 2.2 倍）、wasted 1——**协议税复现**。另：C3-n2 因 agent 起草的 L1 命令（`node -e "..."` 内嵌引号）在 pwsh-sandbox 中 SyntaxError → 验证死循环 → 撞满 480s 超时（`output-C3-n2-transform.log` 完整记录）；该行最终产物正确（success=true）。此为本环境（DSH pwsh-sandbox 引号语义）与"模型自写 shell 谓词"的交互，非判定器故障——跑批器 judge（spawnSync，cmd 语义）对同一任务正确判定通过。

## 3. 判定有效性核查（task-verifier 纪律）

- **数据完整性**：32/32 物理 run 全部落行、sessionLocated 全 true、judge 全量判定、token 估计成功；40 行（含 C1 派生）通过 report.mjs 完整性守卫（物理行=32、总行=40、无 tokenMethod=failed、无 sessionLocated=false）。
- **实时监控**：批全程后台运行，monitor 逐 2 分钟轮询 heartbeat/输出数/rows 行数/流式日志异常；仅 C3-n2 一次 480s 超时（按设计 taskkill 进程树、记录 timedOut、批次继续），无硬异常中止。
- **实现缺陷与重烧（ADR-0013 先例）**：首轮 BUGGY 批暴露 write-outside 相对路径缺陷与 capture 接线缺失，修复后按"判决建立在合意实现上"重烧；两轮独立 task-verifier 复审（第二轮 READY_TO_RUN）确认修复真实、测试 122+32 全绿、离线重放 16 C2 行零假阳性。
- **如实随档（Not verified）**：检出率因零 falseCompletion 不可测；token 为离线下界估计（系统性同向）；n=1 单 seed 方差未量化；C2b 假阳性介入的根因（agent 自报命令引号）为事后归因（ledger 证据），非批中干预。

## 4. 结论解读（对路线图的输入）

1. **C2a 形态值得保留**：被动观察 + 结构事件 + 零协议注入，在正常任务上成本≈原生、零介入——"能正常干活就别管，悄悄验证"在证据上成立。但检出能力因本批无假完成样本而未获证成（悬而未决）。
2. **S2（一次性捕获）的精度在本环境有硬伤**：agent 自报 shell 命令经 DSH sandbox 引号拆坏 → 假阳性介入。若保留 S2，须改为"harness 侧构造验证命令"（D4 方向）或命令模板化，禁止 agent 自写 shell。
3. **检出率无法测量是 spike 的终局限制**：n=1 + 模型过强，对抗面零样本。要测检出率须换更难的对抗任务或增大 n——但按预注册，spike 不重跑、不改判定。
4. **C3 协议税复现 + 环境交互脆弱**：协议面昂贵（2.2–2.6× trips/wall）且模型自写谓词在 sandbox 下死锁——与二阶段 post-mortem 的 Protocol Tax + Bug Amplifier 结论一致。

## 5. 退出线执行（ADR-0017 §8）

FAIL → **Gungnir 运行期控制面形态整体复盘，收缩为离线 Verifier/评估资产**：
- Prove 层（Evidence + Verifier 阶梯 + 判定器）已在三阶段两轮实验中担任外部法官，自证价值（全部 judge 判定与人工一致、零假验收）。
- escalation 后端资产（agent-loop / Branch Search / Recovery）维持冻存，不删、不默认加载。
- 四阶段按离线 Verifier/评估资产形态发布（ADR-0017 既定）。

## 6. 偏差记录（预注册纪律：不回写冻结文件，此处如实记）

- **实现缺陷重烧**（ADR-0013 先例）：BUGGY 批的 write-outside 相对路径缺陷 + capture 接线缺失，修复后重烧全批。修复内容与验证见提交记录与两轮独立审计。
- **C3-n2 超时**：agent 自写带引号 L1 命令在 DSH sandbox 中 SyntaxError → 480s 超时；行保留（success=true、timedOut=true），成因随档。
- **C2b 假阳性介入**：3 次介入（n1×1、n4×2）均为 agent 捕获命令引号拆坏所致；行保留，成因随档。
- **检出率 vacuous**：对抗任务零 falseCompletion，检出率门无法测量（预注册 §8 已声明此风险）。

## 7. 产物清单

- 数据：`tools/experiments/spike/results/spike-2026-08-29T16-23-24-842Z/`（rows.jsonl / report.md / 40 行 / 逐 run 工作区与日志 / 冻结协议与任务集）。
- 实现：`packages/core/src/passive.ts` + `schema/passive.ts` + `schema/envelope.ts`（被动面纯函数与事件）、`packages/dsh-plugin/src/passive-plane.ts` + index/surfaces/engine（被动模式 + wrapup 钩子 + MAF + capture + L4 禁用）、`tools/experiments/spike/`（任务集/预注册/跑批器/指标/门判定/离线重放/监控器）。
- 测试：core 122（含 passive 22 用例）、destruction 32（含 passive runtime 5 用例）。
- 文档：本报告、ADR-0018、state.md、glossary、architecture、project-brief、全阶段计划状态行。
