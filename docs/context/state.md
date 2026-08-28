# 当前状态（L0 活文档）

> 每个工作块结束必须更新。最新在上，旧条目按时间下沉归档。

## 快照（2026-08-29 · 工作块 16–18，二阶段收尾）

- **二阶段（Adaptive Loop Spike）M0–M3 全部完成，B1–B6 全闭环；冻结门判定 FAIL → 熔断出口 (a) 触发：替换默认 loop 路线暂停**。判定与数据：《二阶段阶段报告》（`docs/plan/二阶段阶段报告.md`）；24 run 原始数据 `tools/experiments/stage2/results/stage2-2026-08-28T22-42-03-997Z/`（rows.jsonl/report.md 已入库，重型工件本地留档）。
- **M0（适配与 seam 侦察）**：适配点③ 插件 patch 移除 storage 行（v0.1.2 base 自带，重复 id boot 失败）boot 恢复；适配点① 三工具 additionalProperties 一阶段已写全、boot 实证；适配点② wrapup 时序真跑复核（主链两次全链路 + goal-round 权限路径确定性探针）。peerDep/devDep 重指向 0.1.2（junction 手术：dsh-plugin/agent-loop node_modules → 源码树 vendor+packages；实测教训：`TOOL_RUNTIME_SCHEDULER` 等为普通 Symbol，双副本即断，ADR-0014 单实例纪律）。OPEN-7 关闭：disabled+insert 两步法替换默认 loop（非 insert patch 的 name 是守卫不可改包名——include 算法实测）；`packages/agent-loop`（dsh-gungnir-loop）AdaptiveLoopAgent v0 原生等价 driver 九项职责；gungnir-loop spike profile 真跑全链路。OPEN-5 关闭：tokenMeter 插件侧可达（usage 锚点口径含 cacheReadTokens）。
- **M1（AdaptiveLoopAgent v0）**：core router v0（决策表全单测，Default-to-cheap）+ loop 事件 schema/fold（ADR-0005 预留放开，strict replay：快照一致/turn-step 单调/孤儿锚拒绝）+ 冷重建轨迹 + D-11 前缀闭合；driver 三模式接入 + hysteresis（单 turn 预算 4，ADR-0015）+ resume 从账本现值起步（不重发 from=null）；plugin：gungnirAdaptive 服务 + loop 事件落账 + VERIFY 指令 + FAST 零注入。真实竞态修复：ensureLedger 并发双实例（seq 分叉 fold 拒绝）→ in-flight 去重 + append 串行队列 + appendLoopState 队列内盖章。确定性探针三件（真实 DSH 栈 + 脚本化模型）：② wrapup 时序（<goal_complete> 先于收尾 step，turn-stopping 不抢跑）、D-12 振荡预算、D-13 resume 轨迹续写。B4：三模式真实任务全触发（谎报 claim 被 c1 FAIL 拦下→VERIFY 升级→修正→COMPLETE，假验收 0）。B3 复验 PASS（router 活跃前后各一次，17 类事件词汇一致）。
- **M2/M3（四组对照实验）**：预注册冻结（PRE-REGISTRATION.md：判定门/四组/6 任务 prompt/指标口径/n=6 单 seed）；跑批器（run-groups/metrics/report）+ exp-standard profile；24 run 全量执行（完整性审计：24/24 落行、session 全定位、无超时）。**结果：success 全组 6/6（质量不降、假验收 0）；但 Gungnir 组成本全面反向：input tokens +60.6%、round-trips +237.5%、latency +579.9%、wasted steps 中位 1 vs 0（降幅不可算），0/4 达标 → FAIL**。与 SwitchBench 方向一致且量级更大：小型任务面上 Gungnir 协议仪式固定开销不回本。处置按预注册：gungnir-loop 包与替换机制作资产保留，现役回退一阶段形态（Prove 层跑默认 driver）；重开条件= SHOULD-escalate 正样本任务面证据（阶段报告 §4）。
- **文档义务同批完成**：二阶段阶段报告、dsh-interface §16 + §14 第 10 项转正、architecture 升二阶段形态（含暂停注记）、glossary 四条新术语、二阶段/全阶段/三阶段计划状态行与启动条件修订、ADR-0014/0015、agent-loop 包 README。
- **如实随档（Not verified）**：token 指标为离线 tokenizer 下界估计（plain_text 法，system prompt 与工具 schema 不在 session log，偏差同向）；cache hit 离线不可观测记 null 未进门；n=6 单 seed 方差未量化；②的 goal-round wrapup 真模型场景未被自然触发（模型总在 round 0 完成），由确定性探针补验。
- **下一步**：三阶段按修订后的启动条件重估——Proof-Carrying 支柱可独立启动（Prove 层在默认 driver 上）；Adaptive Runtime 完全体降级为观察项；loop 类重开实验的第一优先问题 = Router 判断"何时不介入"（正样本任务面）。环境侧：正常 shell 下 pnpm install 重放 junction 语义（lockfile 已含 link: 记录）。

## 快照（2026-08-29 · 工作块 15）

- **SwitchBench task-verifier 验收闭环（PASS，13/13 验收标准全过），SwitchBench 线正式收尾**。verifier 实质核查：25 个模块逐个语法检查；15 行 Stage 1 数据与事件流全量对账（metrics 模块独立重算，全部吻合）；HandoffPacket 8 字段加/删字段抛错实测；report 重新生成与现文件逐字节一致；从 payloads 独立重算校准比 0.7119（与 0.712 口径吻合）；selfcheck 5 任务双侧 OK；反作弊扫描（硬编码/空实现/吞异常/测试特供）未发现违规。
- **验收轮修复 4 项（清单全关）**：①MINOR 300s 残留文档对齐 600s——run-baseline.mjs 头注释、`runtimeNotes.taskTimeoutMs`（落盘证据字段）、MD 报告模板三处、run-arch.mjs 头注释；两 runner 的 timeout/runtimeNotes 现均引用 `deadline.mjs` 的 `TASK_TIMEOUT_MS`（单一来源防再漂移）。②INFO state.md 工作块 12 校准比 0.679 → 0.712（verifier 独立重算 0.7119 吻合）。③INFO 删除首启残留空目录 `results/stage1-2026-08-28T17-52-25-310Z/`。④INFO run-baseline.mjs 头注释改为如实表述（"Day 1 建成；Day 5 起 timeout 随事故 #5 统一为 600s"）。
- **落档复核（工作块 15 本会话）**：node --check 双 runner 通过；`0.679/0.634` 全仓无残留；空目录确认已删；deadline.mjs 单一来源接线确认（run-baseline / run-arch / stage1 均引用）。**扫描边界观察**：实验档案内另有三处事故 #5 修正前落笔的 300s 历史表述（`EXPERIMENT.md:200`、`README.md:37`、`src/loops/architectures.mjs:12`），未动；现役权威口径 = BENCHMARK.md §7 事故 #5 + deadline.mjs。
- **未改**：ADR-0013 判决本体、benchmark 冻结物（任务/判据/prompt/约束）、report.md 判词。
- **如实随档（Not verified）**：未重放真实 API 跑批验证 timeout 常量改动后的 run-baseline（同值引用，无行为变化）；冻结物"相对 Day 1 未动"为间接证据（tools/ 无 git 基线）。
- **下一步**：main 线回二阶段 M0（适配三件套 → OPEN-7 / OPEN-5 → ADR-0014）。SwitchBench 线闭环归档，无遗留阻塞。

## 快照（2026-08-29 · 工作块 14）

- **SwitchBench 综合判词深化落档（纯文档，无代码变更）**：按裁决深化稿修订四处——
  - **decisions.md · ADR-0013 修订补充（第 6–9 条）**：⑥ 正式冻结第一设计原则 **Default-to-cheap, escalate-on-evidence（默认不升级，有证据才升级）**，Router 判定不介入时性能应接近普通 DSH = 下阶段 regression baseline；⑦ 方案 A 重新定义为 **Baseline-Preserving Adaptive Runtime**（平时与普通 DSH 一样轻快、仅确凿困难证据才升档，Branch Search 不作默认 Strategy）；⑧ **D1–D4 双读**（"Strategy API 膨胀早期信号" vs "Adaptive Runtime 最小通用 ISA / Gungnir Kernel 候选"，shared observation 与 Claim ≠ Evidence 天然吻合，n=1 不作单边判读，三阶段重估）；⑨ B 关联基础设施（Physical Loop Hypervisor / SafePoint ABI / Loop serialization / Loop handoff protocol）全部停止投资 + **重开 B 三条件（证伪即重开）**。
  - **report.md 综合判词节补齐**：裁决分层（架构裁决 vs 产品性能裁决，不能混读）；"最值钱的一条数据"（89.4s vs 249.8s 而成功率全 100%）；Scope 限定补严谨结论边界 + 重开三条件；附录 A 增 D1–D4 双读注记。
  - **二阶段计划**：§5 增 5.6（下一轮实验 = Router 判断能力：负样本 NEVER escalate 已有，构造正样本 SHOULD escalate；Baseline vs Always Heavy vs Router；目标形态 Gungnir ≈ Baseline on 简单 / > Baseline on 困难）；§3.4 校准输入挂第一设计原则。
- **未改**：ADR-0013 原判决正文与编号（修订为追加块，不重写历史）；ADR-0014 预留不变（M0 替换机制）。
- **下一步**：main 线回二阶段 M0（适配三件套 → OPEN-7 / OPEN-5 → ADR-0014 替换机制）；M3 冻结时吸收 §5.6 设计输入。task-verifier 对 SwitchBench 的验收未执行（goal 暂停中）。

## 快照（2026-08-29 · 工作块 13）

- **SwitchBench 综合判词落档（纯文档，无代码变更）**：Stage 1 三个直接问题的一问一答（Q1 A 全面弱于普通 DSH；Q2 B 更弱除 TTFUA；Q3 分两层——BranchSearchStrategy 不作默认策略、A 所代理的 UnifiedDriver + strategy host 获赞成票）写入 `tools/experiments/switchbench/results/report.md` 新增"综合判词"节：结构性输因（固定开销在小任务面不回本）、B 的最终定位（§8 停止线命中）、router 首个校准点（小任务面正确路由 = 别升级）、scope 限定与重开路径。依据为冻结数据：baseline token 离线估计 ≈59k / 校准比 0.712（附录 B 口径）。
- **二阶段计划挂校准输入**：router v0（§3.4）注明 M1 冻结时吸收 SwitchBench 判词（链接报告）。
- **未改**：ADR-0013 判决本体（本判词是其支撑论证，不新增 ADR）。
- **下一步**：main 线回二阶段 M0（适配三件套 → OPEN-7 / OPEN-5 → ADR-0014）；SwitchBench 归档随档。task-verifier 对 SwitchBench 的验收未执行（goal 暂停中），恢复后补。

## 快照（2026-08-29 · 工作块 12）

- **SwitchBench Day 2–7 完整执行完毕，判决落 ADR-0013：停止方案 B 投资，Adaptive Loop 主线确认方案 A，LoopModule 列为边界观察项**。全部产物在 `tools/experiments/switchbench/`（代码 `src/loops/` + 数据 `results/`）。
- **交付**：UnifiedDriver 基座（单一主上下文 turn 循环 + 工具调度，A/B 共用同一份代码）；方案 A = strategy-host（driveTurn / sub-conversation / 工具面过滤 / 共享观察态四项 driver-core 增长，变形计量对象）+ BranchSearchStrategy；方案 B = 自持 BranchSearchLoop → SafePoint → 8 字段 HandoffPacket → ExecutionLoop（UnifiedDriver 裸用）；run-arch / stage1 / repair-rows / report 全链路 runner；baseline session log 多帧 zstd 解码器 + 官方 tokenizer 离线 token 估计（跨 run 校准比 0.712，用户提供的 `deepseek_v4_tokenizer/`）。
- **Stage 1 结果**（5 任务 × 3 架构 × 1 seed，600s 统一预算，15 行）：VGCR 三架构全 100%；Gate 2 B 达效果优势（wall/success −26%、TTFUA −82%，2/4 项 ≥20%）；Gate 3 劣化（waste 0.55→0.64）+ tokens/success 反向 +73% → §8 停止线命中 → **停止方案 B**；Stage 2 不执行（§6，理由在报告 Day 6 节）。Baseline 全面占优（wall 89.4s）——branch search 固定开销在小型任务面不回本，scope 限定已随档。
- **冻结修正事故**（BENCHMARK.md §7，全部发生在 Gate 判定前）：#5 deadline 300s→600s（用户确认，软 deadline 口径）；#6 A 架构 `REPORT_REQUEST` 误删导入崩溃（t02/t05 行剔除重烧）+ metrics claimedCompletion 被子会话污染（全部 A/B 行自事件流重算）；#7 B 组 HandoffPacket `selected_hypothesis` 字段缺陷（`"hN: undefined"`，5 行全部重烧）。benchmark 冻结物（任务/判据/prompt/约束）零改动。
- **下一步**：SwitchBench 线归档（H1 结论 + LoopModule 边界观察已输入三阶段计划修订口径）；主线回二阶段 M0（适配三件套 → §14 接缝回归 → OPEN-7 替换 seam 实证 + OPEN-5 → ADR-0014 替换机制，编号已顺延）。

## 快照（2026-08-29 · 工作块 11）

- **SwitchBench Day 1 完成（全部产物在 `tools/experiments/switchbench/`）**：benchmark 冻结（5 任务 + ground truth + verifier，Killer = t01，见 `switchbench/BENCHMARK.md`）+ Killer Task 跑通 Baseline 并记录（`results/run-2026-08-28T16-10-13-647Z.{json,md}`：Gate 1 PASS 四条件全绿、src 足迹仅 `coupons.js`、wall 100.2s、session 留档）。
- **新建 Baseline profile `switchbench-base`**（`~/.dsh/profiles/switchbench-base/`，手工建：bundles base+headless、**无 gungnir**、agent-default-model → 冻结模型 jiyuan-lvdong/deepseek-v4-flash-0731；`--dump-config` 验证 357 行装载）——同时绕开 dsh-plugin 适配点③ storage 冲突。
- **验证器按修订版 EXPERIMENT.md §7 Gate 1 四条件实现**（probe / trunk / integrity / exports），`selfcheck.mjs` 双侧自检（pristine 必 FAIL / 规范修复必 PASS）五任务全 OK；约束判据（only-src/no-new-deps/api-stable/stay-in-workspace）与 MUST/SHOULD/IRRELEVANT 测试标注随 `src/tasks.mjs` 冻结。
- **Day 1 事故记录（BENCHMARK.md §7，全部在任何 A/B run 之前）**：①t03 冻结测试期望值笔误修正重冻；②**首跑判废**（工作区在仓库树内，模型在完全访问下读穿 harness 后"修 bug"并自称未改动——工作区已迁系统临时目录 + prompt 约束 6 + src 足迹记录；判废证据存 `results/void/` 永不删除）；③第二次 run 因 manifest 陈旧判无效（假违规），全量重冻；④发现 workspace-write 下 `node --test` spawn EPERM 沙箱事实（WRITE_RESTRICTED 拒子进程管道）→ 冻结 prompt 增环境注记（`--test-isolation=none` 等价路径，三组架构一致；harness 侧 trunk 验证不受影响）；⑤权限档按用户指示定 workspace-write（预检实测工作区内写文件+跑命令无审批墙）。
- **指标口径**：token 计数未接（OPEN-5）→ wall-clock + session id 反查（`~/.dsh/sessions/` cwd 编码目录，v0.1.2 headless 不打印 session id）留档，Day 5+ 从 session log 复盘 Gate 2/3。
- **下一步**：Day 2 BranchSearchStrategy（最强版）；二阶段 M0 排队不变。

## 快照（2026-08-28 · 工作块 10）

- **全面掉头落档（纯文档，无代码变更）**：用户指令 + 《Agentloop自动调整【重新思考版】》结论固化为 **ADR-0012**——替换默认 agent-loop 路线取代 seam 控制平面路线。核心论断经 v0.1.2 源码树复核：agent loop 官方明示可从配置替换（`docs/architecture.md:11,59`、`docs/capability-seams.md:507`、`apps/cli/composition.md:270`）；禁区只有 rewrite history，replace execution policy 是架构本意。
- **新定位与 Slogan**：Gungnir = DSH 的自适应目标导引系统，首个动态调整底层 agent loop 的 DSH 插件；**Lock the goal. Adapt the loop. Prove the hit.**（言出必行；取代旧 tagline，ADR-0001 已标注）。三支柱：GoalSpec（Lock）/ Adaptive Loop Runtime（Adapt）/ Evidence+Verifier（Prove）。
- **阶段重排**：二阶段从"Proof-Carrying"改为 **Adaptive Loop Spike**（三模式 FAST/EXECUTE/VERIFY + 确定性 router + 四组对照实验 + 继续/熔断门，详细计划已整体重写）；原二阶段设计稿移档《三阶段实施详细计划》（设计稿状态，启动条件 = spike 过门）。一阶段资产重定位为 Prove 支柱地基 + loop 传感器/裁判。
- **与 SwitchBench 的关系**：工作块 9 的 SwitchBench v0（`tools/experiments/switchbench/EXPERIMENT.md`）继续独立推进，其裁决的 H1（异构 Loop 拓扑能否干净 Strategy 化）正是 Adaptive Loop Runtime 策略接口设计的关键输入——若 H1 判否，走预登记的 Level 3.5（LoopModule 抽象）。两条线汇合点在三阶段计划修订。
- **本批文档**：AGENTS.md（铁律 1/9 重写：loop 也是插件、禁止物理热插拔；删"永不碰 agent-loop"）、decisions.md（ADR-0012 + ADR-0001/0002 标注）、project-brief、architecture（新分层图 + 机制/策略分离清单）、glossary（Adaptive Loop Runtime / Loop Strategy / Meta-controller / Loop Thrashing / Context Projection 等新术语）、dsh-interface（§3 agentLoop 行转正为"可从配置替换"，§14 加第 10 项 loop seam 复验）、全阶段计划 v2.0（含附录 A 方案 B 存档 + 新熔断表）、二阶段计划整体重写、一阶段计划掉头注记、两包 README（新双语定位 + 清理过期 Known Limitations）、两 tools README、context README 矩阵。
- **下一步**：启动二阶段 M0——适配三件套（③ storage patch → ② wrapup 时序 → ① additionalProperties）+ §14 接缝回归 + OPEN-7（替换 seam 实证）+ OPEN-5（token 可观测性）+ driver 职责清单落档 + ADR-0013（替换机制）。peerDep/devDep `link:` 重指向须正常 shell（本沙箱 pnpm 限制仍在）。SwitchBench Day 1 启动时机仍由用户定，与 M0 互不阻塞。
- **降级退路**：spike 打不过 Code/PTC baseline 或 seam 须改源码才可达 → 回退方案 B（全阶段计划附录 A）；事件语义破坏 = 红线停止。

## 快照（2026-08-28 · 工作块 9）

- **SwitchBench v0 实验计划落盘（纯文档，无代码变更）**：`tools/experiments/switchbench/EXPERIMENT.md`。§1 含方案 A（一个 Agent 一套控制器，Loop ≈ Policy）与方案 B（一个 Goal 多个可交接控制器，Loop ≈ Runtime Resource，仅 SafePoint 切换）正式定义；裁决 H1（异构 Loop 拓扑能否干净 Strategy 化）——方案 A（UnifiedDriver + BranchSearchStrategy）vs 方案 B（BranchSearchLoop → SafePoint → HandoffPacket → ExecutionLoop）vs 普通 DSH Baseline；HandoffPacket 最小 schema、判决线先冻结后写码（三级 Gate：VGCR 一票否决 → 效率四项 → Execution Discipline，外加架构条件"A 出现明显变形"）；sequential 矩阵 5×1 → 10×2；七天日程；第三结局（Strategy API 膨胀 → 抽象 LoopModule，Level 3.5）已预登记。
- **隔离约束（用户明确）**：实验全部产物只在 `tools/experiments/switchbench/`；A 组用实验内 UnifiedDriver 代理未来 Adaptive Meta-Loop，**不依赖、不等待二阶段 M0 任何交付物**，结论标注"UnifiedDriver 代理"口径。
- **下一步**：二阶段 M0（适配三件套 → 四 spike → ADR-0012~0016）照旧排队；SwitchBench Day 1（冻结 Killer Task + Baseline）启动时机由用户定。

## 快照（2026-08-28 · 工作块 8）

- **开发基线切至 v0.1.2-alpha.1 源码构建（ADR-0011，取代 ADR-0010）**：源码树 `pnpm install`（直连 npmjs 大 tarball 超时，走 npmmirror 镜像 40s 完成）+ `pnpm build`（exit 0）；全局 `dsh` 换装 `tools/dsh-shim/` 转发包 → `dsh --version` = `0.1.2-alpha.1`。回滚：`npm install -g @deepseek-ai/dsh@0.1.1-rc.2`。
- **冒烟结论**：v0.1.2 本体正常（web profile dump-config exit 0）；**新发现适配点③（boot 实证）**——v0.1.2 base bundle 自带 `storage`/`storage-json`（root `storages`）+`storage-domain`，与插件 patch 的 storage 插入行冲突（`duplicate loader entry id: storage`，boot 失败）；适配点①②维持源码结论、运行时实证排在③修复后。仓侧回归不受影响：core 79 + destruction 24 全绿。
- **计划层全面对齐**（纯文档）：ADR-0011 落档；dsh-interface.md §15 转正为基线事实（冲突以 v0.1.2 为准）、§14 接缝清单第 7–9 项转现役；全阶段计划 v1.2；二阶段计划改写——M0 变"适配三件套（③②①）+ 四 spike + ADR-0012~0016"，OPEN-3 改写为 `ctx.web.fetch` 插件侧可达性/SSRF 边界，OPEN-5 改写为 `dsh-token-meter` 可达性，§3 增 bundle patch 改动行，风险表重定语境；一阶段计划加基线注记（保持 0.1.1 语境作执行记录）；AGENTS.md 版本行更新。
- **下一步**：启动二阶段 M0——先做适配三件套（③ 修 `packages/dsh-plugin/cordis.patch.yml` 移除 storage 行 → boot 恢复 → ①② 运行时实证），peerDep/devDep `link:` 重指向须正常 shell（本沙箱 pnpm 限制仍在）。

## 快照（2026-08-28 · 工作块 7）

- **二阶段详细计划落盘，无代码变更**：`docs/plan/二阶段实施详细计划.md`（按全阶段 v1.1 §4.2 八项目标展开），里程碑 M0–M5、验收 B1–B8、破坏/实验用例 D-7~D-10。
- **schema v2 设计要点**（全部 additive，KvUnit `version` 保 1 不改）：新增 `external_state`（L3）与 `human` verdict（L5）谓词；human override 走 fold 豁免通道；spec 变更调和规则（`version` 严格 +1 才可换）；`STATUS_EDGES` 加 `WAITING_EXTERNAL`；新事件 `gungnir/invalidate`、`gungnir/wait`。
- **关键基线改动点登记**：`state.ts:107` `effectiveOutcome` 的 `level>=4` 降级必须精确化为 `level===4`，否则 L5 human PASS 会被误降级——已写入计划 §3 改动表。
- **M0 先行项**：四个 spike（OPEN-3 L3 通道、OPEN-4 ask 形态、OPEN-5 token 可观测、OPEN-6 watcher/disarm/resume）+ ADR-0011~0015 先落再动码。
- **下一步**：待用户确认后启动 M0。

## 快照（2026-08-28 · 工作块 6）

- **计划层维护，无代码变更**：一阶段计划评审 + DSH v0.1.2-alpha.1 源码勘察 + 计划适配修订。
- **计划评审修订（全阶段计划 v1.1）**：①一阶段计划与 ADR-0006/0007 脱节 → 卷首回写六条偏差清单；②GOAL_REVALIDATION 归属矛盾 → 一阶段已交付"全量重跑"，二阶段第 7 项改写为 constraints/invariants 总审计增强；③L4-only 判据终局缺口 → 二阶段新增第 8 项（NEEDS_HUMAN 升级路径）+ 实验"可判定"口径跑批前预注册；④三阶段熔断"统计显著"改为预注册效应量阈值（20 样本量级不做显著性判定）；⑤补 spec 变更语义与"用户中途改约束"破坏用例（二阶段第 2 项）。
- **v0.1.2-alpha.1 源码勘察**（三路并行，file:line 证据入 [dsh-interface.md](dsh-interface.md) §15）：核心接缝（pre-step / tools-result / goals / round-driver / commands / userQuestions / shell / llm / storage / 装载 / headless）全部稳定；session log 白名单仍封闭，ADR-0006 维持；两处升级适配点登记（defineTool 强制 `additionalProperties`；tool-goal complete/blocked 改 wrapup、不再硬停 turn，影响终判时序）；新能力归口（subagent `agentOptions` → 三阶段 model 轴；公网 WebFetch + SSRF → 二阶段 L3；`registerConfigurableProviders` → 四阶段可选；`DSH_TELEMETRY_DISABLED=1` 入测试纪律）。
- **ADR-0010 归档**：alpha 期不适配不 bump（锁 `0.1.1-rc.2`）；正式 npm 发布后开升级适配窗口，回归 + 破坏矩阵全绿才做新特性。
- **下一步**：二阶段详细计划暂未启动（用户明确暂缓）；启动时按修订后的全阶段计划 §4.2 八项 + 口径预注册要求开里程碑。

## 快照（2026-08-28 · 工作块 5）

- **阶段**：一阶段（Gungnir Core）M0–M5 **全部完成**，无未交付项（"已知限制"为环境类条目，非代码缺口）。
- **A1 端到端（带凭据真跑，已通过）**：`dsh --profile headless` + 自定义提供商 `deepseek-v4-flash-0731`，全链路走通
  `spec → plan-projection → commit → evidence → claim → verdict → REVALIDATING → COMPLETE`；
  模型是在收到 Gungnir 的 pre-step 指令**之后**才调 `update_goal(action="complete")`（Propose/Authorize 分离生效）。
  第二轮 A1 变体同时带 L2 artifact 与 L1 exit-code 两条判据，亦以 COMPLETE 收尾。
- **`ctx.shell` 语义真跑复核（不再按 .d.ts 猜）**：
  - `ShellRunResult` 映射确认可用：`exitCode` / `stdout.text` / `stderr.text`，`CollectedOutput` 形状与预期一致。
  - sandbox 实测（`mode: workspace-write`）：**工作区内写文件 → exit 0 → L1 PASS**；**写向 `C:\…`（工作区外）→ exit 1 → L1 FAIL，且目标文件从未被创建**。
    → 证实 sandbox authority 仍归原 owner，Gungnir 没有绕过。
  - 代码据此加固：`sandbox.denied` / `sandbox.runnerFailed` 视为**策略拒绝或执行器故障**（抛错 → INCONCLUSIVE，loud fail），
    绝不当成"命令本身失败"折叠成 exitCode，避免用假失败掩盖真故障（Let It Fail）。
- **M5 destruction（D-3/D-5 已补齐）**：新增 `tools/destruction/tests/d3-d5-breakers.test.ts`
  - D-3：重复失败签名 → RETRY → 重试预算耗尽后 `BLOCKED(stuck)`，**永不 COMPLETE**；并确认"重新投影同一 stepId"不能绕过重试预算（同一 actionId 累计）。
  - D-5：模拟 session 压缩后，`ctx.storage` ledger 完好，冷重建结果与压缩前**逐字节一致**，且可继续 append。
  - 破坏测试总数 **24 / 6 文件全绿**（D-1/D-2/D-4/D-6 原有 + 新增 L1/L2/L4 契约测试）。
- **20 任务生死实验（`tools/experiments`，已建成并跑完）**：10 coding + 6 research（L2 判定）+ 2 research-l4（阶梯强制探针）+ 1 谎报 + 1 不可能命令。

  | 指标 | 结果 |
  |---|---|
  | verdict 与 ground truth 一致率 | **100.0% (20/20)** |
  | **假验收** | **0**（最高权重，通过） |
  | 冷重建成功率 | 100.0% |
  | evidence 覆盖 | 100.0% |
  | 开销 | 总 28 轮 / 63 verdict / 110 evidence |

  - **熔断未触发**（阈值：可判定任务一致率 < 70%）。报告：`tools/experiments/results/report.md`。
- **本轮新发现并修复的真缺陷（ADR-0009）**：L2 artifact 判据 `mustExist:false` 时，若文件存在且无其他谓词，会落到 **PASS**——
  即"判据要求文件缺席却判通过"，一条**低层 verifier 的假验收通道**。已改为存在即 `FAIL`（`errorSignature: artifact-present:<path>`），
  并补 `l2-artifact.test.ts` 回归（7 用例）。
  > 为什么比 L4 更危险：L1/L2 被当作**硬证据**支撑 COMPLETE，L4 天然低可信会被降级；低层假验收直接污染终局。
- **测试与类型（全绿）**：core **79** 通过；destruction **24** 通过；core / dsh-plugin / destruction 三包 `tsc --noEmit` 无错。
- **实验设计教训（非系统缺陷）**：内容型对抗任务会被模型自我审查绕过（让它写错内容 → 它写对；要求文件缺席 → 它干脆不创建）。
  假验收探针必须**模型无关**：谎报 a19（什么都不做）、不可能命令 a20（`exit 5` 永远不等于 0）。两者最终均为 BLOCKED，与期望一致。
- **已知限制（环境类）**：
  1. 本沙箱内 `pnpm install` / `pnpm -r` 会触发 safe-delete 失败，`tools/experiments` 因此以相对路径直接 import `packages/*/dist`；换到正常环境补 `pnpm install` 即可。
  2. A1 是以 `headless` profile 驱动同一引擎路径验证（等价），而非手敲 `/ultragoal` 斜杠命令。

## 快照（2026-08-28 · 工作块 4）

- **阶段**：一阶段（Gungnir Core）M0–M4 代码完成，M5 未开始（同前）。
- **本次审查结论**：一阶段核心实现**没有"空函数/注释遮羞"类缺失**（逐文件读过 core 与 dsh-plugin 全部源码）；但**有两个真缺口**，均已修复：
  - 缺口 A：L1 `runCommand` 是 stage-1 stub（直接 throw）→ L1 判定永远走不通。
  - 缺口 B：L4 `llm_rubric` 谓词没有评审对象字段 → verifier 对"空气"打分，真机实测被模型判 `score=0 / "No answer was provided"`，却被记成 FAIL/INCONCLUSIVE（用错误信息掩盖未执行判定，违反 Let It Fail）。
- **本次修复**：
  1. **L1 接线**：`VerifyContext.runCommand` 从 stub 换成 `ctx.shell`（DSH pwsh-sandbox harness 执行器）——`inject` 增 `'shell'`，`ShellRunResult`→`CommandObservation` 映射；信号/启动失败折叠为 `exitCode=1` 并保留 stderr，让 L1 如实 FAIL。**不私开进程**，sandbox authority 仍归原 owner。
  2. **L4 评审对象（ADR-0008）**：`LlmRubricPredicateSchema` 增补可选 `subjectPath`；verifier 无对象/读不到 → `INCONCLUSIVE`（`no-subject` / `subject-unreadable`），有对象才把正文（截断 20k）送进 prompt；prompt hash 改为 `criterionId|rubric|threshold|subjectPath`。
  3. 类型层收口：`makeEvent` 返回类型补 `ts`；core `fixtures.verdictEvent` 的 `level` 收窄为 `1|2|4`；`schema.test` 去掉 `as never`；destruction 测试修 `noUncheckedIndexedAccess` 与未用导入/索引签名；新增 L1/L4 verifier 契约测试。
- **测试结果（全绿）**：core **79** 单测；destruction **15**（D-1/D-2/D-4/D-6 原有 7 + 新增 L1 4 + L4 4）；`pnpm -r typecheck` 全仓库通过；core coverage 97.73% stmts / 95.38% branches（A4 ✓）。
- **真机验证（自定义提供商）**：`deepseek-v4-flash-0731` @ `https://tokenrhythm.studio/v1` 跑 `tools/destruction/llm-smoke.mjs` —— 修复前 L4 对空对象判 score=0；修复后 L4 直连判 **PASS(score=1)**，经引擎整轮后 **raw=PASS → effective=PARTIAL → satisfied=false → 未 COMPLETE**，阶梯强制与 claim≠evidence 在真模型上成立。
- **仍阻塞**：A1 端到端（`/ultragoal` headless 全链路）仍需一次带凭据的真实 profile 跑；`ctx.shell` 接线是按 .d.ts 写的，待真跑复核 `ShellRunResult` 与 sandbox denial 语义。

## 快照（2026-08-28 · 工作块 3）

- **阶段**：一阶段（Gungnir Core）M0–M4 代码完成，M5 未开始。
- **已完成**：
  - M0/M1：repo 骨架；ADR-0006/0007 归档；`@gungnir/core` 全套（schema v1 冻结、fold strict replay、reconciler 决策表+熔断+阶梯强制、verifier 契约、digest）；**79 单测全绿，coverage 97.7% stmts / 95.4% branches（A4 ✓）**。
  - M2–M4 代码：`dsh-gungnir` 插件（ctx.storage KV ledger、evidence 捕获、L1/L2/L4 三 verifier、reconcile 闭环引擎、`/ultragoal`+`/gungnir` 命令、`gungnir_submit_spec/plan/report` 工具、pre-step 追加注入）；bundle patch 已入 `dsh.profile` 层栈。
  - 装载实测：`dsh plugin add` + `--dump-config` 显示 gungnir/storage 行 ✓；`dsh --profile headless` **真实 boot 通过**（apply() 运行无异常），止于 `MISSING_CREDENTIAL`（本机无 DEEPSEEK_API_KEY）。
  - 修复过的实测问题：cordis inject 强制声明（补全 7 个服务键）；storage-json 需要 `root`（`!!js dshHomePath('storage')`）。
- **阻塞**：无 API key，A1 端到端（spec→round→evidence→verdict→status→complete）无法在本机跑通；需在有 DEEPSEEK_API_KEY 的环境执行 `dsh --profile headless "..."` 续验。

## 下一步

1. ~~ExitCode verifier 接线~~ **已完成（工作块 4/5）**：已接 `ctx.shell`，并在真实 profile 上复核了 `ShellRunResult` 与 sandbox denial 语义（见工作块 5 快照）。
2. ~~A1 端到端~~ **已完成（工作块 5）**：带凭据 headless 全链路跑通并到 COMPLETE；可选补做手敲 `/ultragoal` 的斜杠命令形态验证。
3. ~~M5 destruction + 20 任务生死实验~~ **已完成（工作块 5）**：D-1~D-6 齐，24 用例全绿；实验一致率 100%、假验收 0、熔断未触发。
4. ~~进入二阶段~~ **方向已掉头（工作块 10，ADR-0012）**：二阶段重定义为 **Adaptive Loop Spike**，详细计划已就位；**下一步启动二阶段 M0**：适配三件套（③ storage patch → ② wrapup 时序 → ① additionalProperties）→ §14 接缝回归 → OPEN-7（替换 seam 实证）+ OPEN-5（token 可观测性）→ driver 职责清单 + ADR-0014 替换机制落档（原计划编号 ADR-0013 已被 SwitchBench 判决占用，见 ADR-0013 编号说明）。
5. ~~SwitchBench v0~~ **已完成（工作块 12，ADR-0013；工作块 15 task-verifier 验收 PASS 13/13，验收轮 4 项修复全关，SwitchBench 线闭环）**：Day 1–7 完整执行；H1 不成立（本案），方案 B 停止投资，Stage 2 未触发；LoopModule 边界观察随档待三阶段重估。
6. 环境侧（不阻塞阶段推进）：在正常 shell 下补一次 `pnpm install`，让 `tools/experiments` 走 workspace 依赖而非 dist 相对 import；把 destruction + smoke 接进 CI 脚本。新增：正常 shell 下把插件 peerDep/devDep 锁 `0.1.2-alpha.1` 并 `link:` 指向本地源码树（ADR-0011 第 3 条）。

## 工作日志（倒序）

- **2026-08-29（工作块 16–18）**：二阶段收官。M0 适配三件套（③①②）+ peerDep 重指向 0.1.2（junction 手术）+ OPEN-5 tokenMeter 实证 + OPEN-7 替换 seam 两步法实证 + ADR-0014。M1 router v0 + loop 事件放开 + 三模式 + hysteresis + 确定性探针（②/D-12/D-13）+ B3 复验 + B4 三模式真跑 + ADR-0015。M2 预注册 + 跑批器。M3 四组 24 run 对照实验 → 冻结门 FAIL（成本四项全部反向）→ 熔断出口 (a) → 阶段报告 + 计划/上下文全量回写。详见《二阶段阶段报告》。

- **2026-08-29（工作块 11）**：SwitchBench Day 1。冻结 5 任务 benchmark（Killer t01 整单舍入 bug；t02 缓存大小写、t03 CSV 转义、t04 优先级跨模块、t05 段匹配子串——各 ≥3 表面假设、单一行为根因、零依赖 node --test）；Gate-1 四条件 verifier（probe/trunk/integrity/exports）+ manifest 冻结链路 + selfcheck 双侧自检；`switchbench-base` Baseline profile；Killer Task Baseline 真跑 PASS（wall 100.2s，src 足迹单文件）。事故三条（t03 笔误、首跑 harness 泄漏判废、manifest 陈旧假违规）+ EPERM 沙箱环境事实全部冻结修正并记录于 switchbench/BENCHMARK.md §7；权限档按用户指示定 workspace-write。

- **2026-08-28（工作块 10）**：全面掉头落档（纯文档）。ADR-0012 归档：替换默认 agent-loop 为 Adaptive Loop Runtime（一次性组合替换、禁热插拔、机制/策略分离、三模式 spike + 四组对照 + 继续/熔断门、方案 B 为退路）；新定位与 slogan（Lock the goal. Adapt the loop. Prove the hit.／言出必行）。阶段重排：二阶段 = Adaptive Loop Spike（计划整体重写）；原二阶段 Proof-Carrying 移档三阶段设计稿；一阶段计划加掉头注记。AGENTS.md 铁律 1/9 重写；project-brief / architecture / glossary / dsh-interface（§3 agentLoop 行、§14 第 10 项）/ context README 矩阵同步；两包 README 顶部换双语定位并清理过期 Known Limitations；两 tools README 加注。与 SwitchBench（工作块 9）的汇合点定在三阶段计划修订。

- **2026-08-28（工作块 9）**：SwitchBench v0 实验计划落盘（纯文档，`tools/experiments/switchbench/EXPERIMENT.md`）：方案 A（UnifiedDriver + 策略集）vs 方案 B（多 Loop + SafePoint 交接 HandoffPacket）vs DSH Baseline 的裁决实验设计；判决线/停止线先冻结后写码；产物隔离在实验目录内，不依赖二阶段交付物。（本条由工作块 10 补记，详见当日快照。）

- **2026-08-28（工作块 8）**：v0.1.2-alpha.1 源码构建装入全局 dsh（pnpm install 走 npmmirror + pnpm build + `tools/dsh-shim` 转发；回滚路径留档）。冒烟：本体正常；boot 实证新适配点③（base 自带 storage 与插件 patch 冲突，duplicate loader entry id）；core 79 + destruction 24 回归全绿。计划层对齐：ADR-0011 取代 ADR-0010；dsh-interface §15 转正、§14 第 7–9 项现役化；全阶段 v1.2；二阶段计划 M0 改"适配三件套 + 四 spike + ADR-0012~0016"，OPEN-3/OPEN-5 重定向（`ctx.web.fetch` / `dsh-token-meter` 插件侧可达性）；一阶段计划基线注记；AGENTS.md 版本行。无插件代码变更（适配落码属 M0）。

- **2026-08-28（工作块 7）**：按全阶段 v1.1 §4.2 八项目标落二阶段详细计划（`docs/plan/二阶段实施详细计划.md`）：M0–M5 里程碑、B1–B8 验收、D-7~D-10 破坏/实验用例；schema v2 全 additive 设计（L3 external_state / L5 human verdict、human override fold 豁免、spec 调和 version+1、WAITING_EXTERNAL、invalidate/wait 事件）；登记 `effectiveOutcome` 精确化（`level>=4` → `level===4`）等基线改动点；M0 排四个 spike（OPEN-3~OPEN-6）+ ADR-0011~0015 先行。同步 context README 读取矩阵与全阶段计划状态行。无代码变更。

- **2026-08-28（工作块 6）**：计划评审（4 问题 + 2 次要）落修订：全阶段计划 v1.1、一阶段计划卷首偏差清单。v0.1.2-alpha.1 源码三路勘察：核心接缝全稳定、白名单仍封闭（ADR-0006 维持）、两处适配点登记；ADR-0010 定跟踪策略（alpha 期不适配，正式发布后开升级窗口）；dsh-interface.md 增 §15。无代码变更。

- **2026-08-28（工作块 5）**：收尾三件事全部落地。① A1 带凭据真跑：`dsh --profile headless` + `deepseek-v4-flash-0731` 走完 spec→plan→commit→evidence→claim→verdict→REVALIDATING→COMPLETE，模型在收到 Gungnir 指令后才 complete。② `ctx.shell` 真跑复核：`ShellRunResult` 形状与预期一致；sandbox workspace-write 实测（区内写 exit 0 / 区外写 exit 1 且文件从未创建），据实加固 `denied`/`runnerFailed` → 抛错 INCONCLUSIVE 而非折叠成命令失败。③ M5：`d3-d5-breakers.test.ts` 补齐 D-3（重试预算耗尽 BLOCKED，重投影同 stepId 不可绕过）/ D-5（session 压缩后 ledger 冷重建逐字节一致且可续写），destruction 达 24 用例 6 文件全绿；`tools/experiments` 建成并跑完 20 任务生死实验——一致率 100%、**假验收 0**、冷重建 100%、evidence 覆盖 100%、熔断未触发。过程中查出并修复 L2 `mustExist:false` 假验收通道（ADR-0009，补 7 条回归）；另记录实验设计教训：假验收探针必须模型无关。清理冒烟临时文件并扩 `.gitignore`。
- **2026-08-28（工作块 4）**：审查"一阶段是否完整实现"——结论：无空函数/注释遮羞，但有两个真缺口并已修：L1 runCommand stub → 接线 `ctx.shell`；L4 谓词缺评审对象 → ADR-0008 增 `subjectPath` 并让 verifier 无对象即 INCONCLUSIVE。补 L1/L4 契约测试；全仓库 typecheck 通过；core 79 + destruction 15 全绿；用自定义提供商 `deepseek-v4-flash-0731` 真机跑通 L4 冒烟（PASS→PARTIAL，不 COMPLETE）。
- **2026-08-28（工作块 3）**：M2–M4 插件代码完成并 build/typecheck 绿；发现并落地 dsh.bundle.patch 机制（manifest `dsh.bundle.patch` → 自动入 bundles 层）；headless 真实 boot 通过（无凭据止于 MISSING_CREDENTIAL）；architecture.md/AGENTS.md 铁律 2 同步 ADR-0006 载体勘误；两包 README 落盘。
- **2026-08-28（工作块 2）**：M0 repo 骨架落盘；接缝深勘：OPEN-1 结论为否定（自定义 session 事件类型无法通过 resume 白名单），OPEN-2 代码级验证通过；ADR-0006/0007 归档；dsh-interface.md 回写。
- **2026-08-28**：完成全项目规划。产出全阶段计划、一阶段详细计划、AGENTS.md、上下文方案。决策 ADR-0001～0005 归档。
