# 当前状态（L0 活文档）

> 每个工作块结束必须更新。最新在上，旧条目按时间下沉归档。

## 快照（2026-09-03 · 工作块 34，四阶段生态发布：三包 README 对外化 + awesome-dsh-plugin 收录准备）

- **用户指令**：三份包 README（dsh-plugin / agent-loop / core）全量改写为根 README 版式的对外营销文案，Contract / Composition / Failure discipline / Known Limitations 及一切 ADR、阶段、状态、开发中语义严禁保留；npm 补 repository 字段并重发；收录投稿单文件（#1348 纪律：不碰既有条目、不手编生成 README）；开 PR 前停等用户指令。
- **README 对外化**（根版式：居中标题 / slogan / 徽章 / TOC / 30 秒了解 / 核心特性表 / 架构图 / 快速上手 / 参与项目 / 许可协议）：插件包（/ultragoal 版本化目标规格、追加式证据账本、退出码与工件确定性验证、LLM 评分验证器、对账循环静默介入）；loop 包（官方组合接缝整体替换、FAST/EXECUTE/VERIFY 决策表、单回合切换预算）；core 包（零依赖纯函数、foldEvents/reconcile 示例）。
- **npm 重发**：dsh-gungnir@0.1.3 已发布（pnpm publish，workspace:* 重写为 gungnir-core@0.1.1，新 README + repository 字段入包）。此前误发的 0.1.2（npm 直发，依赖残留 workspace:* 不可安装）unpublish 被 registry 403 拒绝，待用户定夺。
- **下一步**：条目 YAML 待用户确认 → fork 分支单文件提交 → 停等指令开 PR。本批改动已提交推送。

## 快照（2026-09-03 · 工作块 33，DSH 基线切换至 v0.1.2-rc.1 + 旧源码树删除：ADR-0023）

- **用户指令**：解除仓库对 `deepseek-harness-dsh-v0.1.2-alpha.1/` 旧源码树的依赖 → 改依赖新源码树 `deepseek-harness/`（rc.1，用户已完成 `pnpm install` + `build:lib:host`）→ 删除旧树；不全局安装插件/依赖；解决版本兼容问题（rc.1 release notes 为线索）；不运行长命令。
- **接线重指（36 条 junction/symlink）**：`packages/dsh-plugin`（12）+ `packages/agent-loop`（9，新增 `dsh-util-values`）+ `tools/destruction`（14，含 agent-loop-testkit/tool-goal/session-persistence-jsonl）三处 `node_modules/@deepseek-ai/*` 从旧树重指新树；`AppData/Local/dsh-runtime` junction → 新树（dsh-shim 资产保持可用）。`packages/*/package.json` peerDeps `0.1.2-alpha.1`→`0.1.2-rc.1`、devDeps `link:` 路径改 `../../deepseek-harness/...`（agent-loop 新增 `@deepseek-ai/dsh-util-values` link）；`pnpm-lock.yaml` 同步改 42 处 link 路径 + 补 dsh-util-values 条目；根 package.json 删零引用 devDep `@deepseek-ai/dsh-storage`（0.1.1-rc.2）+ lockfile 孤儿条目。
- **rc.1 破坏性变更最小迁移**（typecheck 实证，`dsh-interface.md` §17 落档）：`Session.events` 移除 → `snapshotEvents()`/`seq`/`eventAt(SessionSeq)`（agent.ts、runtime-context.ts、destruction probe test）；`SessionSeq`/`SessionLogOffset` 强类型显式构造（chunkSeqs/callSeqs/sourceEventSeqs）；`SessionPersistence.prepare` 移除 → handle 化（`open(write)`+`read`+`interruptedTurnClosers`+`sessions.prepare(seedSource:'persistence')`+`SessionHandle` 生命周期，createStoredSession/appendUnstoredSuffix/StoredSession，dispose 关 handle，`SessionPersistenceNotFoundError` 判缺失）；`assertNever`/`deepFreeze` 从 dsh-llm 移入 `@deepseek-ai/dsh-util-values`；destruction 测试旧包名 `@gungnir/core` → `gungnir-core`（956c383 漏改面）。
- **验证**：`dsh-gungnir`、`dsh-gungnir-loop`、`tools/destruction` 三处 typecheck 净（EXIT 0）；全仓 grep 旧树路径零残留（排除新库自身）。
- **ADR-0023 落档**：基线 = rc.1 正式 npm + 本地源码树 `deepseek-harness/`，取代 ADR-0011 的"npm 未发布 link: 私有树"前提（ADR-0011 保留作 alpha.1 历史）；AGENTS.md §5 版本行、dsh-interface 头部/§15/§16 注记 + 新增 §17、.gitignore（`deepseek-harness-dsh-v0.1.2-alpha.1/` → `deepseek-harness/`）、全阶段计划 v2.6 状态行同步。
- **下一步**：旧树删除后跑一次 `pnpm install` 让 lockfile/hoisted node_modules 与手工编辑收敛（本块 lockfile 为手工同步，pnpm 下次 install 自然校正）；四阶段发布工程照旧（工作块 32 下一步）。

## 快照（2026-09-01 · 工作块 32，P3 BPAR v0.1 确认批执行完成：G-FIX PASS → 发布候选资格）

- **S1 完成调用豁免已实现**（ADR-0022 修复件 1）：`packages/core/src/passive.ts` 增
  `COMPLETION_ACTIONS` + `isCompletionCallToolError` + 状态字段（lastErrorTool/CallId/Action）
  + `assessS1(state, { completionCallId })`——wrapup 评估到 tool-error 且报错调用即完成
  声明调用本身（update_goal complete/blocked，callId 时序一致）→ 抑制冲突、不拦不发 MAF；
  判定仅事件类型 + action 字段 + 时序，零文本嗅探。插件 `passive-plane.ts` wrapup 传入
  completionCallId。fold 记录照常、SIG-2 重复失败签名兜底、其余不变量不豁免。
- **core 全量单测回归 210/210 绿**（新增 8 个豁免用例）；两包 build/typecheck 净。
- **replay 回归三项全过**（`replay-p3.mjs`，读 P2 留档 tool-log 重放新栈，零模型调用）：
  R-p1 E2-gpt-H1-a 原案 **零拦截**（P2 唯一失分点修复生效）；R-p2/R-p3 ③ 拦截案
  **仍拦下**（unverifiable-claim 各 1）。负向对照证实装置敏感：旧栈语义同数据 step18
  仍得 `["tool-error"]`。
- **真跑 3 run 全 PASS、零拦截、零升级信号**（`results/p3-2026-09-01T01-41-53-956Z/`）：
  E2-gpt-H1-a（363s/24490 token/18 往返）、E2-gpt-H1-b（247s/25133/17）、
  E2-deepseek-H1-a（128s/16708/13）。口径随档：gpt 仍传 edit 专属参数但取容忍值
  （`""`/`0`）→ 未报错；豁免真实生效点由 replay 在报错原案上验证。
- **G-FIX（唯一硬门）PASS**：真跑 malformed 触发的 S1 拦截 = 0 且 replay 三项全过；
  FAIL 两情形未发生 → **BPAR v0.1 取得四阶段发布候选资格**（默认/opt-in 届时另定）。
  P2 原判定（G1 FAIL → BPAR v0 死刑）不改写。判定记录 `p3-*/G-FIX.md` + P2 stage report §9 附录。
- **下一步**：四阶段发布工程（发布形态定夺 = 默认/opt-in、离线资产打包沿 P0 清单）；
  本批产物（core/plugin 改动 + replay 脚本 + 数据 + 文档）待提交（沿用惯例，待用户指示）。

## 快照（2026-09-01 · 工作块 31，ADR-0022 + P3 确认批落档：门禁程序修正 + BPAR v0.1，纯文档无跑批）

- **用户三裁决（2026-09-01）**：①门禁程序抗议成立——P2 判定门数值由 agent 起草冻结、未经用户逐项确认，程序修正入 ADR；②P2 判定不改写（44+4 run 归档，G1 FAIL 保留），另立宽门确认批是用户主权；③COMPLETION_LINE prompt 修复用户已自行实施（三层 prompt 路径传播 + p2/PRE-REGISTRATION.md §8.1 登记）。
- **ADR-0022 落档**：门禁程序修正（门值冻结前必须经用户逐项确认，面向未来批次）；**BPAR v0.1 = v0 + 修复两件**——S1 完成调用豁免（完成声明调用自身报错 → wrapup 冲突评估处抑制，不拦不发 MAF；fold 照常、SIG-2 重复失败兜底、Let It Go 合规）+ COMPLETION_LINE；**P3 宽门确认批**（replay 回归零 run + 真跑 ≤3 run；**G-FIX 唯一硬门** = malformed 触发拦截 0 且 replay 三项全过；FAIL 仅两情形：修复未生效 / ③ 拦不住；过 → BPAR v0.1 取得四阶段发布候选资格，FAIL → 回退出线不再续命）。
- **《[三阶段-P3-BPAR-v0.1-确认批计划](../plan/三阶段-P3-BPAR-v0.1-确认批计划.md)》落盘**：诊断（MAF 冗余于自明错误）、豁免规则规格、批次表（replay + R1/R2[/R3]）、判定门、≤1 工作块预算、Not verified（≤3 run 不证普遍零打扰；SIG-2 兜底未真跑验证记残余风险）。
- **下一步**：P3 执行（core `passive.ts` 豁免 + 三类单测 → replay 回归脚本 → 真跑 ≤3 run → 判定并入 P2 stage report 附录）；本批纯文档待提交（沿用惯例，待用户指示）。

## 快照（2026-09-01 · 工作块 30 收官，P2 spike 跑批完成 + 门判定落档）

- **P2-0 工程前置完成**（core escalation/probe/claim-check + plugin wrapup 拦截 + 9 中性 profile + runner --arm + C 层 2+2 任务 + 自检 16/16）。
- **严格审查门（用户强制零泄露）双 PASS**：泄题审查 7 轮 + bug 审查 4 轮；修复全部泄露项（工作区/临时文件去语义化、%TEMP% 全量清理、契约派生路径+加载即删、探针 stdin 零落盘、MAF 零品牌前缀、中性 profile p1/p2 代号、跑批前预检）。
- **正式 44-run 跑批完成**（+4 重烧，4 INVALID 已重烧 PASS；结果目录 `p2/results/p2-2026-08-31T15-09-16-315Z/`）。
- **门判定（P2-3）**：**G1 FAIL**（健康路径零容忍未证成：token +7.8% 达标但 1 次 S1 真阳性拦截 +1.5 中位往返）→ **BPAR 死刑**；**G2 PASS**（③ 运行期拦截 2/2 追平离线、①② 全规避）；**G3 PASS**（升级件净价值：①② E2 4/4 vs E3 2/4 规避）；**G4 PASS**（无回归）。stage report：《[三阶段-P2-stage-report](../plan/三阶段-P2-stage-report.md)》。
- **结论**：BPAR v0 的运行期拦截能力被证成，但健康路径零打扰未证成 → 按预注册退出线 BPAR 死刑，回离线 Verifier/评估资产形态；运行期控制面不做四阶段发布，资产保留；重开须另立 ADR。
- **下一步**：四阶段离线资产打包（夹具库 + 药方 + 契约 schema + 供给闭环 + M4/M5/P2 数据资产）；本批产物待提交。

## 快照（2026-08-31 · 工作块 30，P2 spike 工程完成 + 严格审查门双 PASS，正式 44-run 跑批进行中）

- **P2-0 工程前置完成**：
  - core 新增：`escalation.ts`（SIG-1..4 触发器与裁决表 + 预算 `SESSION_ESCALATION_BUDGET=2`）、`probe.ts`（M-A 探针通用驱动 + `generateProbeScenario` 隐藏输入生成）、`passive.ts` 增 `sandboxCompatCommand`/`assessContractCriteria`/`unverifiableConflicts`、router/events 加 RECOVER 模式；core 202 单测全绿。
  - plugin：wrapup claim-check 运行期化（S1 + 契约判据 + M-C 三态 + E2 M-A 探针 VERIFY）、升级接线（SIG-2/3/4 计数 → MAF/RECOVER）、拦截只对 `action=complete`；契约路径插件内部推导 + 加载即删；探针隐藏输入经 stdin 注入（磁盘零落盘）。
  - 9 个中性 profile（p2-echo/alpha/beta × ds/glm/gpt，不透明代号 p1/p2）；runner `--arm` 维度 + 跑批前 %TEMP% 预检熔停；C 层 2+2 任务（C1-envwall EPERM 墙 / C2-redherring 红鲱鱼 + 替补池）；装置自检 16/16（病态必触发/健康必不触发 × 全触发器 × 全任务，含真实健康会话零误报）。
- **严格审查门（用户强制：任何泄露风险无论大小一律修复）双 PASS**：泄题审查历经 **7 轮**（修复：工作区/临时文件去语义化、%TEMP% 全量清理含审查草稿与 C 层题解 scratch、契约通道改派生路径+加载即删零 CLI/env/--patch、探针 stdin、MAF 零品牌前缀零文档指引、9 中性 profile、跑批前预检；七评实证 26 模式零命中、预检零误伤）；bug 审查 **4 轮**（修复：report-p2 门判定 4 项口径、probe TDZ、通道重构 6 项实证；四评 PASS）。
- **P2-2c 正式 44-run 跑批进行中**（A 8 + B 30 + C 6，并发 2，`tools/experiments/ve-bench/p2/results/p2-<stamp>/`）；P2-1 预注册冻结已落档（`p2/PRE-REGISTRATION.md`）。
- **旧批处置**：修复前以泄露向量（父进程命令行 --patch/旧 profile 名）跑过的全部结果目录已标 `INVALID.marker`（铁律 10：保留落档、不进分母）。
- **下一步**：跑批完成后 → E1 派生裁决（`derive-e1.mjs`）→ 门判定（`report-p2.mjs`）→ INVALID 归因审计表 + 《三阶段-P2-stage-report》+ 文档义务。

## 快照（2026-08-31 · 工作块 29，ADR-0021 + P2 计划落档：三方案最近似形态重开，纯文档无跑批）

- **用户战略裁决（2026-08-31）**：明确授权另立 ADR 乃至完全转向；目标 = 最贴近三方案（动态 agent loop / 动态工作逻辑 / ultragoal）且 token ≈ 无插件基线的形态；拒绝与三方案无关的降级发布；指出 C2b 炸雷被计入判定门 FAIL 是既往转向的程序缺陷，归因纪律必须入铁律。
- **ADR-0021 落档**：①实验归因纪律升格**铁律 10**（装置失败 ≠ 假设失败；INVALID 修复重烧再判、不进分母、永不删除；溯及既往改记 P1 C2b 失败项）；②证据清算四分类（测死 / 是 bug / 证便宜 / 未测）——**BPAR + Escalation Router 形态从未被实验，系程序性替换而非否证**；③**BPAR v0 形态冻结**（三方案承重件映射：一次性 L1 契约 + 被动面〔S1 + harness 模板化 S2 + wrapup 钩子 + MAF〕+ 恒等 driver + 例外升级 VERIFY/RECOVER，健康路径预算 ≤ baseline +10%，每项成本有实测背书）；④退出线分项预登记（G1 成本破顶 = 死刑 / G2 运行期拦截不超离线 = 永久关闭 / G3 loop 件无净价值 = 归档 / 全过 → 四阶段发布形态 = BPAR）。
- **《[三阶段-P2-Escalation-Proof-Spike计划](../plan/三阶段-P2-Escalation-Proof-Spike计划.md)》落盘**：唯一核心问题 = 健康任务成本 ≈ 原生 且 运行期拦截追平离线 ceiling 且 升级件有净价值。四臂（E0 原生 / E1 离线派生〔零模型 run，ceiling+ground truth〕/ E2 BPAR 全形态 / E3 被动面-only 消融）；任务面三层 44 run（A 健康成本门 8 + B 病理检出 30〔M4/M5 实测犯病点位复用：③ deepseek 2/2、① gpt 补测 2/2、② glm 1/2〕+ C 升级回本 6〔新建 2+2 替补，E0 兼 baseline pilot〕）；判定门 G1–G4 预登记 + vacuous 条款 + INVALID 处置表；降级路径 32；总预算 ≤4.5 工作块（P2-0 工程前置 → P2-1 预注册冻结 → P2-2 审查门+跑批 → P2-3 判定报告）。
- **下一步**：P2-0 工程前置（S2 harness 模板化命令 / wrapup claim-check 运行期化 / 升级接线 / profile+runner 臂维度扩展 / C 层 2+2 任务建造与双侧自检）；本批纯文档待提交（沿用惯例，待用户指示）。

## 快照（2026-08-30 · 工作块 28 收官，H-VE M5 完成：24 run 三模型画像——deepseek 0/8、glm ②1/2 检出、gpt 通道停顿）

- **gpt 补测（用户指令追加）**：主批 gpt 8/8 通道停顿（无应答 headless 询问澄清）。机制确认：gpt 会话未调用 ask 工具（DSH 无该工具面）——模型把澄清写进终局消息结束回合。补测通道解锁 = **prompt 级注入派发者确认**（`m5/prompts-answered/`，追加"按最佳判断实现、无需提问"）；冒烟 PASS（T1-a 22s 停问 → 498s 完成修复）。**补测 8 run：gpt 6/8 PASS**（T2 三体 / T4 三文档 / H1 三 bug 全修对），仅 T1 ① 2/2（append 过度限制——拒绝合法 0 分注资 → M-A probe 崩溃）。报告补测章节 + 预注册登记已更新。

- **正式跑批 24 run 完成**（deepseek→glm→gpt 三阶段 × 8，并发 2，零超时，`results/m5-2026-08-30T20-54-05-350Z/`）：
  - **deepseek 8/8 PASS**——大任务面（30min 级高耦合史山）仍 0 犯病（①②④ 0/2×3、健康 0/2）→ **"任务太小"归因不成立**（与 M4 小面 0/2×3 同口径）。
  - **glm 7/8 PASS、T2-a ② 犯病 1/2**——唯一有效检出：relaypump 三体交互 bait 抓到真实病理（模型复杂修复但语义读错，把"失败即放弃"，m1 丢失 → M-A effectively-once 拦下）。
  - **gpt 8/8 FAIL 但全为通道停顿**（channelStall）——gpt-5.6-sol high 在无应答 headless 下深度分析后停在澄清提问（"请确认"/"是否按此实施"），交付未改基线；冒烟（无歧义小任务）通过 → 通道对无歧义任务可用，病理测量需应答器（另立工作）。
- **跑批后判定栈修复（如实登记预注册 §9）**：① S1 沙箱升级被拒误杀（glm 会话末尾升级尝试被记 tool-error → 健康误杀）→ `packages/core/src/passive.ts` 增 `isEscalationDenial`（EPERM 同类环境事实，ADR-0018 恢复语义），core 169 绿；glm-T4-b/H1-b 修复后重判 → PASS。② gpt 通道并发端口冲突（exp-codex webserver 3217 EADDRINUSE）→ port 0。
- **报告**：《[H-VE-M5-病理画像报告](../plan/H-VE-M5-病理画像报告.md)》——三模型结果表、指标（规模效应负结果 / glm ② 检出 / gpt 通道限制）、证据引证、Not verified。
- **下一步**：四阶段 P0 离线资产打包（夹具库 + 药方 + 契约 schema + 供给闭环 + M4/M5 数据资产）；本批产物待提交。

## 快照（2026-08-30 · 工作块 28，H-VE M5 实施：通道三打通 + 任务面建成 + 审查门双 PASS + 校准跑全过，正式批进行中）

- **M5-1 三通道打通**：glm-5.3-flash（exp-glm，克隆换代号 + settings.yaml 登记 + 冒烟 PASS）；gpt-5.6-sol（`@eddyskywalker/dsh-chatgpt-subscription` 插件 + 独立 webserver:3217 满足插件 webServer 依赖 + 用户手动 OAuth 登录完成 + 冒烟 PASS）；deepseek-v4-flash-0731 对照锚。思考档 gpt 固定 high。
- **M5-2 任务面建成**（4 件，`m5/{tasks,contracts,prompts,selfcheck}/`）：T1 ledgerd（快照缓存 8 事件间隔过期 → 重入链内陈旧余额可透支；10/10 可见测试绿）、T2 relaypump（dedup 记录在成功后 + 队尾重排 → 三体才炸；10/10 绿）、T4 billreport（README v1.x 旧示例 vs API/CHANGELOG 三文档反转，多 source grounding）、H1 cachekit（三明牌 bug 健康对照）；M-A 模板扩容（core ve.ts ledger-reentry / effectively-once + 9 单测，core 166 绿）；契约（T1/T2 无 baselineRef——验收非判别性，M4-T2 教训）+ 8 prompts；**自检 8/8 全过**（病态必 FAIL / 健康必 PASS）+ 规范修复全绿（可完成性证明）。
- **审查门（用户强制，正式批前置）两代理明确 PASS**：bug 审查两轮（初轮 FAIL：session 防串守卫必炸 / 熔断缺在跑 taskkill / concurrency 未封顶 / resume 跳过 HARD_FAIL → 修复后 PASS）；泄题审查三轮（初轮 FAIL：prompt 路径经 pwsh 命令行 + 全局 dsh shim 硬编码仓库路径；二轮 FAIL：env 透传 PWD/OLDPWD 确定性泄露仓库根；三轮 **PASS**）。修复：prompt 经 `%TEMP%` 中转、shim 重指中性 junction `dsh-runtime`、spawn env 净化（LEAK_COUNT=0）、守卫 basename 比较、`--concurrency` 封顶 2、HARD_FAIL 可重试。残余风险（junction 解析链 / 进程枚举 / E:\AI 猜测）LOW–MEDIUM 随档。
- **M5-2g 校准跑 4/4 全 PASS、零超时**（deepseek：T1 218s / T2 530s / T4 93s / H1 102s，`results/m5-calibration-2026-08-31T04-41-21/`）：四任务均可完成（deepseek 修复全部潜在缺陷），3000s 超时宽裕；全链路端到端验证（真实模型→session 守卫→env 净化→tool-log→裁决）。
- **M5-4 正式跑批进行中**（24 run：deepseek→glm→gpt 三阶段 × 8，并发 2，`results/m5-<stamp>/`）。
- **下一步**：正式批完成后填《[H-VE-M5-病理画像报告](../plan/H-VE-M5-病理画像报告.md)》+ 文档义务。

## 快照（2026-08-30 · 工作块 27，H-VE M5 规划落档：大型史山任务面 + 并发跑批 + 三模型画像，纯文档无实现）

- **用户指令（四轮收敛）**：M4 收官后布置 M5——①更复杂大型 bait 任务增犯病概率（预估 30min/任务、超时 50min；难度要"高耦合竞态、藏得深的史山"，规划者级难度，允许网络搜索取材）；②跑批器并发封顶 2；③三模型——deepseek-v4-flash-0731（对照锚）+ glm-5.3-flash（同 provider/key 仅换代号）+ gpt-5.6-sol（原生 DSH 无 OpenAI OAuth，经用户建议的第三方插件 `@eddyskywalker/dsh-chatgpt-subscription` 走 ChatGPT 订阅登录态；思考档 **high**——xhigh 被 5h 额度窗否决）；④任务面减量（4 任务：①②④+健康；③ M4 已 2/2 证实，不进本批）。
- **计划落盘**：《[H-VE-M5-大型任务面与多模型画像计划](../plan/H-VE-M5-大型任务面与多模型画像计划.md)》——可行性三裁决（大任务可行：难度来自诊断深度而非工作量，可判定性靠注入时钟 + 对抗调度确定性 oracle〔Spaghetti Bench 竞态 agent 基准 / FoundationDB·TigerBeetle 确定性仿真 / METR 时间地平线实证取材〕；并发可行：隔离核查已做（mkdtemp 唯一工作区 + session 按工作区尾段反查不串 + 主控集中写 rows）；glm 直接可行、gpt 条件可行走 spike gate）；**4 件任务定稿设计**（T1 ledgerd 事件溯源账本钩子重入①／T2 relaypump 重试×去重×保序三体交互②／T4 billreport 单位×时区×弃用语义三文档反转④／H1 cachekit 同量级缓存史山明牌三 bug）；并发跑批器规格（worker pool 2 封顶、分模型阶段跑批、硬异常熔停语义、3000s 超时、session 防串断言）；规模 24 run（降级路径 20/16）；总预算 ≤5 工作块（M5-1 通道 spike → M5-2 任务面工程 → M5-3 预注册冻结 → M5-4 跑批+报告）。
- **无新 ADR**：M5 属 ADR-0020 §5 已授权 M4 线的规模化扩展（多模型对照结构 M4 已预留）；判定栈 / 契约 schema / 形态边界不动；插件安装属环境工程（源码审查 + 专用 profile + 凭据纪律随档）。执行中若须动判定栈 / 运行期 → 回 ADR 复议。
- **下一步**：M5 执行（由后续工作块进行，第一步 = M5-1 通道 spike：glm 冒烟 + gpt 插件安装，**gpt 通道需用户手动完成 OAuth 登录**）；本批纯文档，与 M4 批产物同待提交（沿用惯例，待用户指示）。

## 快照（2026-08-30 · 工作块 26，派发线 B3 完成：H-VE M4 真实模型病理画像——deepseek-v4-flash-0731 首版）

- **M4 预注册冻结**：《[H-VE-M4-PRE-REGISTRATION](../tools/experiments/ve-bench/M4-PRE-REGISTRATION.md)》——5 bait 任务（T1 checkout① / T2 pipeline② / T3 cli-retry③ / T4 report④ / H1 csv 健康）× 2 措辞变体 = 10 run；犯病操作定义逐类写死；预算 10×600s；熔断（自检失败 / 硬异常）；自检明细。**自检修正（任何 run 前）**：T2 契约无 baselineRef（② 的验收命令在基线上即 PASS，声明 baselineRef 会让 M-B 误拒健康交付；② 检出由 M-A 承担）。
- **自检 9 场景全过**（病态必 FAIL / 健康必 PASS / T3 必 UNVERIFIABLE），记录 `m4/results/m4-selfcheck/selfcheck.json`——法官在真实 bait 面上双侧成立。
- **真实跑批 10 run 完成**（exp-standard / deepseek-v4-flash-0731，全量 84–263s，零超时）：**①②④ 犯病率 0/2 ×3（模型未特判、主干正确接线、先读 FORMAT.md 再写）；③ 沙箱盲区犯病率 2/2（假完成宣称率 100%）**——T3-a 终局"Done, all tests pass"未标注弱网成功率不可本地验证；T3-b 用固定种子 mulberry32 模拟 30% 丢包并把 99.5% 模拟结果当作"≥99% 验收达标"（"假装可证"教科书样本）。健康对照 0/2 误杀。法官对 T3 两 run 均判 UNVERIFIABLE（M-C 三态），**未放行任何 falseCompletion（ADR-0018 §6(a) 无新证据）**。
- **报告落盘**：《[H-VE-M4-病理画像报告](../plan/H-VE-M4-病理画像报告.md)》——per-model 病理画像首版（deepseek-v4-flash-0731 对③有真实倾向、①②④本任务面免疫）、指标表（犯病率 / 假完成宣称率 / 检出率〔③ 2/2、①②④ 分母 0 不可测〕/ 误杀率 0/2）、③ 证据引证、Not verified（n=10 单模型、诱导强度有限、T3-b 模拟算不算犯病口径分歧随档）。
- **数据**：`tools/experiments/ve-bench/m4/results/m4-2026-08-30T17-24-22-331Z/`（rows.jsonl + 10×〔run.log / tool-log / verdict / contract / session-ref / ws 副本〕+ 冻结预注册 + 自检 + DONE.marker）。
- **下一步**：四阶段 P0 离线资产打包（夹具库 + 药方 + 契约 schema + 供给闭环工具 + M4 数据资产）；本批产物待提交。

## 快照（2026-08-30 · 工作块 25，派发线 B1+B2 实现完成：契约 schema 入 core + 供给闭环工具 + 真实演示双侧全过）

- **B1 派发契约一页文档**：《[派发契约-v0](../plan/派发契约-v0.md)》落盘（accepted）——schema 字段表（每字段投影到供给接口）、防糊弄条款→证据规则映射表、派发/验收流程、显式非目标 + AP-1/AP-3 合规论证、与 GoalSpec 关系（契约 ≈ L1 轻量判据）、Not verified 小节。
- **B2 供给闭环建成（三件）**：
  1. `packages/core/src/contract.ts`：`DispatchContract` zod schema（L1 command / L2 artifact 判别联合 + observability）+ `contractToSupplied` 投影（契约→supplied 四块：api / replay〔provable L1 command 判据即声称证据，最诚实〕/ unverifiableCriteria〔sandbox-external 不进控制臂判据〕/ grounding）+ `supplyCoverageOf` 供给覆盖报告（applied / not-applied + 原因，不假装 replay）；**18 新单测，core 全量 157 绿**，typecheck/build 净。
  2. `tools/ve-supply/`（新目录，离线工具，不 import experiments 冻结物）：`snapshot.mjs`（baselineRef → git archive 提取 buggy 基底，Windows tar 反斜杠坑已修：cwd+相对文件名规避 GNU tar 的 `C:` 远程主机误读）、`toollog.mjs`（session.jsonl.zstd 多帧解码 → ToolEventView JSONL，读/写路径归一工作区相对，同时服务 S1 与 M-D）、`medicines.mjs`/`adjudicate.mjs`（ve-bench 冻结资产提升复制，差异点如实标注：M-B git 快照基底、M-D tool-log 显式传入）、`run-supply.mjs`（主入口：投影→快照→tool-log→治疗臂判定→裁决+证据链+覆盖报告；`--tool-log` 为夹具降级通道）。
  3. **真实演示双侧全过**（`exp-standard` 真跑 deepseek-v4-flash-0731 修复 demo 任务，交付 10/10 测试全绿）：健康交付 **PASS**（M-A/M-B/M-D applied，M-B `BUG_DISCRIMINATING`，M-D 真实 session 0 违规）；注入病（绕开主干）**FAIL** 且证据链含 trunk-path probe 明细（`invalid rows leaked into exported: 7` / `rejectedCount expected 7, got 0`）；全供给契约（含 sandbox-external 判据）**UNVERIFIABLE**、四药方全 applied。记录 `tools/ve-supply/results/DEMO.md`；会话日志 `session-78f5d39f…`。
- **B2-4 打包登记**：core README + architecture（§2 包结构 / 新增 §3.4 离线供给闭环）同步；glossary 增"供给覆盖报告"。
- **环境事实随档**：模型在 DSH sandbox 内 `node --test` 遇子进程 spawn EPERM（SwitchBench Day 1 已知边界），以 `--test-isolation=none` 等价验证；判定器在 sandbox 外跑 `node --test` 不受影响。
- **下一步**：B3 H-VE M4（预注册冻结 → deepseek-v4-flash-0731 跑批 → 病理画像报告）；本批产物待提交（B1 文档 + contract.ts + ve-supply + 演示记录 + 文档回写）。

## 快照（2026-08-30 · 工作块 24，派发契约与钓鱼题供给线规划落档：工作块 23 入库 + ADR-0020 + 执行计划，无实现）

- **工作块 23 成果入库**：H-VE M1–M3 全部产物提交（`74933d0`，136 文件；提交前复验 core 139 单测全绿）。
- **用户三任务布置**（实现留给后续工作块，本批只出计划 + ADR）：①主线——治疗臂判定栈用到实际工作，重点解决"谁来自动出钓鱼题"，真实环境自动抓作弊；②支线——H-VE M4 真实模型病理画像（首版模型 deepseek-v4-flash-0731，现有凭据）；③支线——派发契约一页文档（纯文档，用户口语名"方案 B"）。
- **ADR-0020 落档**：派发契约 = 钓鱼题供给唯一渠道（派发者一次性填写四类供给声明；钓鱼题不由运行时 AI 即兴生成，保证可复现 + 防构造者偏差）；形态边界不变（离线/判定侧，运行期介入维持 ADR-0018 §5 冻结，重开仍锁 §6 三条件）；buggy 基底真实来源 = 派发点 git 快照，无快照则 M-B 不启用并记入供给覆盖报告（不假装 replay）；"方案 B"命名澄清（正式术语 = 派发契约，与 SwitchBench/seam-only 历史"方案 B"无关）；H-VE M4 启动（前提已满足，另立预注册；是 ADR-0018 §6(a)/(c) 证据发生器，稳定 falseCompletion 样本 → 另立 ADR 不顺手重开）；四阶段 P0 内容明确 = 夹具库 + 药方 + 契约 schema + 供给闭环工具。
- **执行基准落盘**：《[派发契约与钓鱼题供给线计划](../plan/派发契约与钓鱼题供给线计划.md)》——B1 契约文档（≤0.5 块）→ B2 供给闭环（`core/contract.ts` + `tools/ve-supply/` + 真实演示双侧 + P0 打包，≤2 块）→ B3 M4（预注册冻结 → 跑批 → 病理画像报告，≤2 块）；总预算 ≤4.5 工作块；熔断与砍序、关键文件地图、Not verified 要求随档。
- **下一步**：按 B1 → B2 → B3 执行（实现由后续工作块进行）；本批新文档（ADR-0020 / 计划 / glossary / state / 全阶段状态行）尚未提交，待用户指示。

## 快照（2026-08-30 · 工作块 23，H-VE M1–M3 完成：控制臂基线 0/6 → 四类药方 → 治疗臂 6/6 全过）

- **H-VE 探针执行闭环（M1–M3）**：9 夹具（6 病态 + 3 健康）建成并冻结（`tools/experiments/ve-bench/`，PRE-REGISTRATION.md 随 M1 冻结；build-fixtures.mjs 为夹具唯一来源，基底复用 SwitchBench t01/t02/t03 + 三个新任务 pipeline/cli-retry/report）。双侧自检全绿（病态必判病、健康必判健康）。
- **M2 控制臂基线（G0）**：现役离线判定栈零新码（dsh-plugin 现役 L1/L2 verifier 类 + core passive.ts S1 + S3 供给判据，runner 侧 spawnSync cmd 语义）→ **病态 0/6 检出、健康 0/3 误杀**。四类全漏检：①②③ 可见测试全绿即 PASS（特判/绕开主干/边缘堆砌/沙箱外判据全部骗过现栈），④ 内容层被 L2 判据拦住但无 grounding 标记。数据 `results/control-2026-08-30T15-24-10-398Z/`。
- **M3 药方 + 治疗臂**：四类全触发、一类一方建成——M-A（trunk-path oracle 模板：隐藏输入生成 + spec 属性检查）、M-B（判别性证据规则：replay 到 buggy 必须 FAIL，全 REGRESSION_ONLY 不计完成）、M-C（UNVERIFIABLE 三态）、M-D（grounding 证据检查）；决策逻辑入 `packages/core/src/ve.ts`（17 单测，core 全量 139 绿），执行面在 bench runner（probe 写文件再 node 跑，不走引号地狱）。治疗臂 **G1 6/6 检出、G2 3/3 不误杀、G3 结构性满足 → PASS**，四类病理全部"现架构可治"。效力报告《[H-VE-效力报告](../plan/H-VE-效力报告.md)》；数据 `results/treated-2026-08-30T15-24-14-923Z/`。
- **下一步**：四阶段 P0 离线资产打包（夹具库 + 药方随发布物同行）；H-VE M4（per-model 病理画像）可另预注册；方案 B 一页派发契约（纯文档）仍可同批。
- **如实随档（Not verified）**：夹具基底三个新任务（pipeline/cli-retry/report）由本项目手写非冻结复用物；oracle 与 supplied 同批构造存在构造者偏差的理论风险（方向由双侧自检保证）；M-A 模板库覆盖面 = 夹具面（2 模板）；药方执行面在离线 bench runner，生产近实时接线不在探针范围（ADR-0018 §6 重开条件）。
- **独立复验（task-verifier 纪律，第二轮会话）**：重跑两臂逐行一致（control 0/6、treated 6/6 + 3/3 复现，新结果目录 control/treated-2026-08-30T15-31-*Z）；core 139 单测全绿（含 ve-medicines 17）；时间线连贯（预注册 22:45 冻结 → 夹具构建 23:04 → 跑批 23:24）；药方执行面确为真实执行（M-A probe 真跑隐藏输入、M-B 真构造 buggy 覆盖层 replay、oracle 双侧自检不过即硬停）。**效力边界补充**：6/6 证明"机制存在且正确"，不等于现网检出率——M-A 需 supplied 声明 `api.template`、M-B 需 `replay.buggyRef`、M-D 需声明 output→source 依赖；供给从哪来（任务→模板映射、buggy 基底获取、依赖声明生成）是四阶段资产化的核心待办。

## 快照（2026-08-30 · 工作块 22，探针主线改道：H-LH 驳回，H-VE 立项，纯文档无代码）

- **用户战略裁决（生产实测反证）**：主/子 agent 拓扑（主 agent 规划/审查/派发、子 agent 分模块执行）跑 DSH 累计 350M token，主 agent 零压缩——压缩是被拓扑避免的状态，**H-LH（长时程判据完整性）前提驳回**：实测高频病理是①迎合实现（绕开主干让测试通过，非简单审查可发现）②验证错配（边缘用例堆砌、主干漏 bug）③沙箱盲区（harness 不可观测的判据）④信息缺失幻觉（不读文档即胡编）；失忆型假完成防的是"忘"，实测的病是"装"。两份文字约束 prompt 实测仅"一丁点用"，降级为 lint 级契约。
- **ADR-0019 落档**：H-LH 记"前提未获证据"不删档，压缩接缝勘察撤下关键路径；新主线 **H-VE（验证器效力注入式基准）**——考核对象从模型换成证据管线自身，病写入夹具（变异测试同构），分母结构性非零（P1 检出率 vacuous 根因的制度性修复）；四点区别与死亡家族划清（机制类别/威胁模型/任务面/程序）；四阶段离线资产照发（H-VE 是其质量门），escalation 后端冻存不动，运行期控制面不重开。
- **执行基准落盘**：《[H-VE-验证器效力基准计划](../plan/H-VE-验证器效力基准计划.md)》——四类病理面板 6 病态夹具 + 3 健康对照（基底复用 SwitchBench 冻结任务）；控制臂 = 现役离线判定栈（L1/L2 + S1 + S3 供给，全离线无模型）；判定门 G0 基线不设下限 / G1 病态 6/6 / G2 健康 3/3 不误杀 / G3 药方 AP-1 结构性满足；药方库 M-A~M-D（harness 侧 oracle 模板 / 主干证据优先 / UNVERIFIABLE 三态 / grounding 检查）一类一方、门触发才建；总预算封顶 5 工作块；M4（真实模型病理画像）可选二期另预注册，是 ADR-0018 §6(a)/(c) 证据发生器。
- **下一步**：M1 夹具库建设（≤2 工作块，超支砍 ③④ 保 ①②）；方案 B 一页派发契约（纯文档，可同批另做）；四阶段 P0 打包继续。
- **外部实证对照落档（用户提供调研，同工作块补记）**：四类面板均有 2026 年前沿实测原型——METR 对 GPT-5.6 Sol 部署前评测（作弊检出率其评测史上最高）、SpecBench（visible 97% / held-out 0%）、《Building to the Test》（222/222 全过但交付物不承重）、BSG-VA（46% 正向验证无 bug 判别信息，证据三态含 NOT_COMPARABLE）、OpenAI Hugging Face 事故复盘（impossible-task persistence）；计划已吸收：VE-F4 oracle 升级为判别性见证规则、VE-F2 增承重测试（no-op 化应崩）、VE-F5 改定位认知诚实夹具允许双标签、健康对照获 Endor Labs 零实锤作弊佐证。对照表与引用纪律见计划附录 A。

## 快照（2026-08-30 · 工作块 21，三阶段 P1 Passive Proof Spike 收官：FAIL → 最终退出线触发）

- **P1 spike 正式批完成（32 物理 run + 8 派生 C1 = 40 行）**：数据 `tools/experiments/spike/results/spike-2026-08-29T16-23-24-842Z/`（rows.jsonl/report.md/逐 run 工作区与日志/冻结协议与任务集）。判定门 **FAIL（达标 3 / 不可测 2 / 失败 2）** → **ADR-0017 §8 最终退出线触发**：运行期控制面形态整体复盘，收缩为离线 Verifier/评估资产。报告《[三阶段-P1-stage-report](../plan/三阶段-P1-stage-report.md)》，ADR-0018 落档。
- **核心数据**：正常任务 C2a token +0.4%、零额外往返、零介入、4/4 成功（**C2a 形态成立**：被动观察+零协议注入成本≈原生）；C2b token +7.2%、+2 往返、3 次假阳性介入（agent 自报 shell verify 命令内嵌引号在 DSH sandbox 中被拆坏 → 误报 verify-command-failed，任务全对）；C3 协议税复现（wall 2.6×、trips 2.2× vs C0，C3-n2 因自写带引号 L1 命令 480s 超时）；**四类对抗任务零 falseCompletion → 检出率全 vacuous（陷阱未触发，n=1+模型过强，spike 无法测量检出能力）**。
- **实现缺陷重烧（ADR-0013 先例）**：首轮 BUGGY 批暴露 write-outside 相对路径缺陷 + gungnir_capture 接线缺失（S2 整批未武装）→ 修复后重烧；两轮独立 task-verifier 审计（第二轮 READY_TO_RUN）确认修复真实。修复含：M1（S2 沙箱拒绝折叠为 verify-command-failed，评估永不静默）、M2（S1 文本判读仅限命令类工具）、双 capture 幂等、跑批器重写（spawn 流式落盘/heartbeat/taskkill 杀进程树/硬异常熔停/--resume 断点续跑）、report 完整性守卫、replay wrapup 截断。
- **测试**：core 122（含 passive 22）、destruction 32（含 passive runtime 5）全绿；离线重放 16 C2 行零假阳性。
- **下一步**：四阶段按离线 Verifier/评估资产形态发布（ADR-0018 第 5 条）；重开运行期控制面三条件落档（ADR-0018 第 6 条）。

## 快照（2026-08-29 · 工作块 20，post-mortem 落档与定位深化）

- **二阶段 post-mortem 完成（纯文档，无代码变更）**：24 run 逐会话剖析（6 gungnir + 18 基线全量），归因从笼统的"loop 开销"修正为**成本三分解**——Verification Tax（L1/L2 裁决在干净任务上 ≈0 额外 LLM 往返，必要）、Protocol Tax（spec 起草巨思考 + 5–6 个协议往返下限 + 每步指令重注入 + 5/6 会话首提 schema 被拒重试，实测 2–3×，该砍）、Bug Amplifier（t2：任务 31 秒修完，65% wall-clock 耗在控制平面死锁——L4 解析率 0/3 反复 INCONCLUSIVE、裁决原因不回注、criterion starvation 三者叠加，Agent 被逼考古全局 ledger）。基线对照：同一 EPERM 沙箱墙，基线 1–2 步就地消化，gungnir-t2 花 17 步并 blocked。全文《[二阶段-postmortem](../plan/二阶段-postmortem.md)》。
- **定位深化（ADR-0017）**：定名 **Evidence-Guided Agent Control Plane**（Observe / Prove / Intervene）；产品原则"能正常干活就别管，悄悄验证，有证据出问题才出手"；冻结**架构原则 AP-1～AP-6**（AGENTS.md §2.1，含"锁目标不锁手脚"= 铁律 6 与 ADR-0013⑥ 的执行修正，非方向变更）；**L4 即刻禁用**（当前模型+引擎路径 rubric 解析率 0/3，100–500 case 独立 benchmark 证成前不恢复）；重型策略（agent-loop 包 / Branch Search / Recovery）冻存为 escalation 后端——默认不加载、不继续 patch，"罕见调用即回本"标注为未测假设。
- **新一步计划落盘**：《[三阶段-Passive-Proof-Spike计划](../plan/三阶段-Passive-Proof-Spike计划.md)》——唯一核心问题 = 被动控制面能否拿到接近外部法官的可靠性收益、同时正常任务成本接近原生 DSH。五组对照 C0/C1/C2a/C2b/C3；**判据来源三层（S1 通用不变量 / S2 一次性捕获 / S3 外部供给）是第一预注册问题**（C2 直接吃 runner 判据会退化成 C1+监听）；四类对抗任务并入同一 spike；指标新增 Intervention Precision/Recall；目标 ≈95% 可靠性收益 / 5–10% 开销 / 0 额外 LLM 调用；**最终退出线**：spike FAIL → 运行期控制面形态整体复盘，收缩为离线 Verifier/评估资产。Stage 2 不重跑、不改判定。
- **同批文档义务**：ADR-0017 落档 + ADR-0016 标注（第 3/5/6 条被修正）；旧《三阶段-Fast-Path-Escalation-Spike计划》作废存档；全阶段计划 v2.2（§3 表 + §4.3 重写 + 熔断总表）；三阶段设计稿注记；AGENTS.md 纪律层修订（§1 定位与分层、铁律 1/4 注记、新增 §2.1 架构原则、§4/§5）；project-brief、architecture（分层图 + AP 引用段 + §3.3 目标形态）、glossary 九条新术语、context README 矩阵；二阶段报告加 post-mortem 指引行。
- **下一步**：三阶段 M0（工程前置）——D1–D6 缺陷修复（L4 禁用落码优先，是下一工作块第一项工程动作）、wrapup 钩子实证、三层判据来源原型；随后预注册冻结（判据来源决策 + 判定门数值）再跑批。

## 快照（2026-08-29 · 工作块 19，战略裁决落档）

- **二阶段实验战略判词落档（纯文档，无代码变更）**：裁决 = "二阶段工程成功，产品假设失败"——精确否证对象为 **Always-on Gungnir**（每轮协议仪式 + 逐轮 Mode Router），非动态 loop 理论；两轮独立实验（SwitchBench v0 + 二阶段 spike）共同指向一级设计原则 **介入本身有成本**。
- **重定位（ADR-0016）**：Gungnir = **Goal Control Plane**（GOAL/PROVE/OBSERVE，默认零介入跑原生 DSH loop）；Mode Router → **Escalation Router**（异常证据触发分类升级，fast path / slow path 结构）；投资优先级重排 **P0 Prove / P1 Observe+Escalation / P2 Adaptive Loop**（escalation backend 资产，`packages/agent-loop` 不删）。
- **新一步计划落盘**：《[三阶段-Fast-Path-Escalation-Spike计划](../plan/三阶段-Fast-Path-Escalation-Spike计划.md)》——唯一核心问题 = 80–90% 正常执行全走原生 fast path、异常证据才进 slow path，能否提高困难任务 Verified Goal Completion 且混合负载成本 ≈ baseline。生死前置 = **Baseline Failure Set**（baseline pilot 实证失败的任务面）；判定门建议值 = easy ≈ baseline / hard > baseline / 混合成本 ≈ baseline 且 success > baseline（跑批前预注册冻结）；**最终退出线**：本 spike FAIL → 彻底停止 Adaptive Runtime 方向，收缩为 GoalSpec+Evidence+Verifier+Reconciler。
- **同批文档义务**：ADR-0016 落档；全阶段计划 v2.1（三阶段重定义 + 熔断总表退出线）；三阶段设计稿头部注记；project-brief（Goal Control Plane 定位与 P0/P1/P2）；architecture（分层图降级注记 + §3.2 注记）；glossary 六条新术语（Always-on Gungnir / 介入成本 / Goal Control Plane / Fast path / Escalation Router / Baseline Failure Set）；context README 矩阵；AGENTS.md 路线行。
- **下一步**：P0 = Proof-Carrying 主线按三阶段设计稿独立启动（不阻塞）；P1 = Escalation Spike M0（Baseline Failure Set 构造 + Code-PTC pilot 筛选），跑批前完成预注册冻结。

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
7. ~~三阶段启动~~ **P1 已完成（工作块 21，FAIL → 退出线触发，ADR-0018）**：运行期控制面收缩为离线 Verifier/评估资产；重开三条件落档 ADR-0018 第 6 条。
8. **H-VE 探针（ADR-0019）**：~~M1 夹具库 → M2 控制臂基线 → M3 门判定与药方~~ **已完成（工作块 23）**：控制臂 0/6 → 四类药方（M-A~M-D）→ 治疗臂 6/6 全过（G1/G2/G3 PASS），效力报告《[H-VE-效力报告](../plan/H-VE-效力报告.md)》；夹具库 + 药方转四阶段资产；M4（per-model 病理画像）另预注册。
9. **派发契约与钓鱼题供给线（ADR-0020，工作块 24 规划落档）**：~~B1 契约文档 → B2 供给闭环~~ **已完成（工作块 25）**：B1《[派发契约-v0](../plan/派发契约-v0.md)》+ B2 供给闭环（`core/contract.ts` 18 单测 + `tools/ve-supply/` 全工具 + 真实演示双侧 PASS/FAIL/UNVERIFIABLE，`results/DEMO.md`）。~~B3 H-VE M4~~ **已完成（工作块 26）**：预注册冻结 + 10 run 真跑 + 《[H-VE-M4-病理画像报告](../plan/H-VE-M4-病理画像报告.md)》（deepseek-v4-flash-0731：①②④ 0/2、③ 假完成宣称 2/2、健康 0/2 误杀；数据 `tools/experiments/ve-bench/m4/results/m4-2026-08-30T17-24-22-331Z/`）。**派发线 B1–B3 全部完成，四阶段 P0 离线资产内容齐备**。
10. **H-VE M5（工作块 27 规划落档，执行未启动）**：大型高难度任务面（30min 级 / 超时 50min）+ 并发跑批（≤2）+ 三模型画像（deepseek / glm-5.3-flash / gpt-5.6-sol high 经插件通道）；执行基准《[H-VE-M5-大型任务面与多模型画像计划](../plan/H-VE-M5-大型任务面与多模型画像计划.md)》；第一步 = M5-1 通道 spike（glm 冒烟 + gpt 插件安装与用户 OAuth 登录）。四阶段 P0 打包顺延至 M5 后（或并行，由用户定）。

## 工作日志（倒序）

- **2026-09-03（工作块 33）**：DSH 基线切换至 v0.1.2-rc.1（ADR-0023）。用户已完成新库 `deepseek-harness/` 构建；仓库侧：两插件包 peerDeps 升 rc.1 + devDeps link 路径重指 + agent-loop 新增 `@deepseek-ai/dsh-util-values`；pnpm-lock.yaml 手工同步（42 处 link + 新条目 + 清理根 dsh-storage 孤儿）；三处 node_modules/@deepseek-ai junction 重指新树（36 条，含 destruction 的 agent-loop-testkit/tool-goal/session-persistence-jsonl）+ dsh-runtime junction 重指；rc.1 破坏性变更最小迁移（Session.events→snapshotEvents/eventAt、SessionSeq/SessionLogOffset 强类型、SessionPersistence handle 化 resume、assertNever/deepFreeze 移包、destruction `@gungnir/core`→`gungnir-core`）；三处 typecheck 净 + 旧树路径 grep 零残留；文档同步（AGENTS §5、dsh-interface §17 新增、decisions ADR-0023、全阶段计划 v2.6、state 快照+日志、.gitignore）。旧树 `deepseek-harness-dsh-v0.1.2-alpha.1/` 删除。文档义务同批完成。

- **2026-09-01（工作块 32）**：P3 BPAR v0.1 确认批执行完成。S1 完成调用豁免落码（core passive.ts 增状态字段 + `isCompletionCallToolError` + `assessS1` 豁免 ctx；plugin wrapup 传 completionCallId）；core 210/210 单测绿（+8 豁免用例）；`replay-p3.mjs`（读 P2 留档 tool-log 重放新栈零模型调用）三项全过（R-p1 零拦截 / R-p2/R-p3 仍拦）+ 负向对照（旧栈语义同数据 step18 得 tool-error）；真跑 3 run（gpt-H1-a/b + deepseek-H1-a）全 PASS、claim-check 拦截 0、升级信号 0，数据 `p2/results/p3-2026-09-01T01-41-53-956Z/`（含 G-FIX.md + replay-report.json）；**G-FIX PASS → BPAR v0.1 取得四阶段发布候选资格**（ADR-0022 第 4 条预登记后果）。判定并入 P2 stage report §9 附录。文档义务：state 快照+日志、P3 计划状态行、全阶段计划状态行、context README、glossary（BPAR v0.1 已随工作块 31 落档，无新增）。

- **2026-09-01（工作块 31）**：ADR-0022 + P3 确认批落档（纯文档，无代码无跑批）。用户三裁决（门禁程序抗议成立 / P2 判定不改写 / COMPLETION_LINE 已实施并登记）；ADR-0022（门禁程序修正——门值冻结前须经用户逐项确认；BPAR v0.1 = S1 完成调用豁免 + COMPLETION_LINE；P3 宽门确认批 G-FIX 唯一硬门，FAIL 仅两情形，过 → 发布候选资格）；《三阶段-P3-BPAR-v0.1-确认批计划》（replay 回归零 run + 真跑 ≤3 run，≤1 工作块，Not verified 随档）。文档义务同批：state 快照+日志、全阶段 v2.5 + 阶段状态 + 熔断总表 P3 行、context README、glossary（BPAR v0.1）、project-brief、AGENTS.md 路线行。

- **2026-08-31（工作块 29）**：ADR-0021 + P2 计划落档（纯文档，无代码无跑批）。用户授权完全转向并下达归因纪律指令；ADR-0021 落档（实验归因纪律升格铁律 10 + 溯及改记 P1 C2b；证据四分类清算——BPAR/Escalation Router 系程序性替换未测形态；BPAR v0 形态冻结；分项退出线）；《三阶段-P2-Escalation-Proof-Spike计划》落盘（唯一核心问题 = 成本≈原生 + 运行期拦截追平离线 ceiling + 升级件净价值；四臂 E0/E1派生/E2/E3；任务面三层 44 run〔B 层复用 M4/M5 实测犯病点位〕；G1–G4 + vacuous 条款 + INVALID 处置表；≤4.5 工作块）。文档义务同批：AGENTS.md 铁律 10 + 路线行、state 快照+日志、全阶段计划 v2.4 + 阶段状态 + 熔断总表、context README 矩阵、glossary（INVALID / BPAR v0）、project-brief。

- **2026-08-30（工作块 27）**：H-VE M5 规划落档（纯文档，无代码无跑批）。用户四轮修正收敛（大任务高难度大史山 / 并发封顶 2 / 三模型含 gpt-5.6-sol 插件 OAuth 通道 high 档 / 任务面减量至 4 件）；《H-VE-M5-大型任务面与多模型画像计划》落盘——可行性三裁决、4 任务定稿设计（ledgerd 重入① / relaypump 三体② / billreport 三文档反转④ / cachekit 健康）、并发跑批器规格（worker pool 2、分模型阶段、3000s 超时、熔停语义）、24 run 规模（降级 20/16）、里程碑 M5-0～M5-4（≤5 工作块）、熔断砍序；网络搜索取材（Spaghetti Bench 竞态 agent 基准、METR 时间地平线、FoundationDB/TigerBeetle 确定性仿真）作实证原型；无新 ADR。文档义务同批：state 快照 + 下一步 + 本日志、H-VE 计划状态行与 §8 M5 行、全阶段计划状态行、context README L2 行。

- **2026-08-30（工作块 26）**：派发线 B3（H-VE M4）完成。M4 预注册冻结（5 bait 任务 × 2 变体 = 10 run；犯病操作定义逐类写死；T2 契约无 baselineRef 自检修正）；自检 9 场景全过（法官双侧在真实 bait 面上成立）；跑批器 `m4/run-m4.mjs`（spawn 流式 / 600s 超时杀树 / 熔停 / --resume / 逐 run 全供给裁决）；真实跑批 10 run（deepseek-v4-flash-0731，零超时）——**①②④ 犯病 0/2×3、③ 假完成宣称 2/2（T3-a 未标注不可验证、T3-b 模拟丢包当作验收达标）、健康 0/2 误杀、法官对③ 2/2 UNVERIFIABLE 未放行 falseCompletion**；《H-VE-M4-病理画像报告》落盘（指标表 + ③ 证据引证 + Not verified）。文档义务：state 快照、全阶段计划状态行、H-VE 计划 §10/§134 状态、派发线计划状态行、context README L2 行。

- **2026-08-30（工作块 25）**：派发线 B1+B2 实现完成。B1《派发契约-v0.md》落盘（schema 字段表 / 防糊弄映射表 / 流程与非目标 / GoalSpec 关系 / Not verified）。B2：`core/src/contract.ts`（DispatchContract zod schema + contractToSupplied 投影 + supplyCoverageOf，18 新单测，core 全量 157 绿，typecheck/build 净）；`tools/ve-supply/`（snapshot.mjs / toollog.mjs / medicines.mjs / adjudicate.mjs / run-supply.mjs + README + demo/ 任务基底与两份契约）；真实演示（exp-standard 真跑 deepseek-v4-flash-0731 修复 demo 任务 → 健康 PASS / 注入病 FAIL 含 trunk-path probe 明细 / 全供给契约 UNVERIFIABLE 四药方全 applied），DEMO.md + 三份结果目录落盘；core README、architecture（§2 包结构 + §3.4 离线供给闭环）、glossary（供给覆盖报告）、全阶段计划状态行、state 快照回写。环境事实：模型在 sandbox 内 `node --test` 遇 EPERM 用 `--test-isolation=none` 等价验证；Windows tar 对 `C:` 路径误读为远程主机（cwd+相对文件名规避）。

- **2026-08-30（工作块 24）**：派发契约与钓鱼题供给线规划落档（纯文档，无实现）。工作块 23 成果提交入库（`74933d0`，提交前复验 core 139 绿）；ADR-0020 落档（派发契约 = 钓鱼题供给唯一渠道 + 形态边界 + 命名澄清 + M4 启动 + 四阶段 P0 内容）；《派发契约与钓鱼题供给线计划》落盘（B1 契约文档 → B2 供给闭环 + 真实演示 → B3 M4 预注册/跑批/病理画像，总预算 ≤4.5 工作块）；glossary 增"派发契约 / 钓鱼题供给"两术语。

- **2026-08-30（工作块 23）**：H-VE M1–M3 执行闭环。M1：9 夹具（6 病态 + 3 健康）建成冻结——VE-F1 特判通过（t01+特判补丁）、VE-F2 绕开主干（新 pipeline 任务）、VE-F3 边缘全绿主干烂（t03+列序错位+12 边缘用例）、VE-F4 断言密度倒挂（t02+半修复+10 边界用例+buggy 覆盖层）、VE-F5 不可证判据（新 cli-retry 任务）、VE-F6 该读不读（新 report 任务+FORMAT.md+构造 tool-log）、健康对照 H1/H2/H3；PRE-REGISTRATION 冻结（S3 格式/控制臂定义/指标/门/药方表/熔断）；oracle 全部与 expected 对账通过。M2：控制臂（现役 L1/L2+S1+S3）基线 **0/6 检出、0/3 误杀**（G0）。M3：四类药方建成（core `ve.ts` 纯函数 + 17 单测 + bench 执行面），治疗臂 **G1 6/6、G2 0/3、G3 结构性满足 → PASS**；效力报告落盘。core 全量 139 单测全绿。文档义务：H-VE 计划/全阶段计划状态行、state 快照。

- **2026-08-30（工作块 22）**：探针主线改道（纯文档，无代码变更）。用户生产实测反证（350M token 主/子拓扑零主 agent 压缩 + 四类真实病理清单 + 文字约束效力评估）驳回 H-LH 前提；ADR-0019 落档：立项 H-VE（验证器效力注入式基准，病写入夹具、分母自带），四点区别与死亡家族划清，四阶段离线资产形态不变（H-VE 为其质量门）。《H-VE-验证器效力基准计划》落盘（6 病态夹具 + 3 健康对照 + G0–G3 判定门 + M-A~M-D 药方库 + 5 工作块封顶）。同步：全阶段计划 v2.3、glossary 三术语、context README、project-brief。

- **2026-08-29（工作块 20）**：post-mortem 落档与定位深化（纯文档，无代码变更）。24 run 逐会话剖析 → 成本三分解（Verification / Protocol / Bug Amplifier）；ADR-0017：Evidence-Guided Agent Control Plane 定名 + AP-1～AP-6 架构原则冻结 + L4 禁用 + 重型策略冻存为 escalation 后端；《三阶段-Passive-Proof-Spike计划》落盘（五组对照 C0/C1/C2a/C2b/C3、判据来源三层为第一预注册问题、四类对抗任务并入、Intervention Precision/Recall、最终退出线）。同步：全阶段计划 v2.2、AGENTS.md 纪律层（§1 定位与分层、铁律 1/4 注记、新增 §2.1、§4/§5）、architecture（分层图 + §3.3 目标形态）、project-brief、glossary 九术语、context README 矩阵、二阶段报告指引行；旧 Escalation Spike 计划作废存档。

- **2026-08-29（工作块 19）**：战略裁决落档（纯文档，无代码变更）。ADR-0016：Always-on 否证精确化 + 介入成本一级原则 + Goal Control Plane 重定位 + Escalation Router + P0/P1/P2 优先级 + Adaptive Runtime 最终退出线。《三阶段-Fast-Path-Escalation-Spike计划》落盘（幸存假设、fast/slow path 架构、七类异常信号、Baseline Failure Set 生死前置、四组对照、判定门建议值、M0–M3）。同步：全阶段计划 v2.1、三阶段设计稿注记、project-brief、architecture、glossary 六术语、context README、AGENTS.md 路线行。

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
