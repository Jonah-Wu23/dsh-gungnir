# 二阶段 Post-mortem：高消耗会话归因分析（2026-08-29）

> **性质**：事后归因分析，**不改变《[二阶段阶段报告](二阶段阶段报告.md)》的冻结门 FAIL 判定**——冻结结论永久保留，不因事后发现实现缺陷而修改（预注册纪律）。本文件修正的是"为什么 FAIL"的归因，是三阶段新产品假设（Passive Proof，ADR-0017）的设计输入。
> **数据来源**：`tools/experiments/stage2/results/stage2-2026-08-28T22-42-03-997Z/` 全部 24 run 的 session log 逐事件剖析（6 个 gungnir 会话 + 18 个基线会话同口径）、全局 ledger（`~/.dsh/storages/gungnir_ledger.json`）裁决记录、tokenMeter usage 锚点（stderr）。

## 1. 归因修正：Loop Tax → Protocol Tax

阶段报告的原始数字（input tokens +60.6%、round-trips +237.5%、latency +579.9%）容易被读成"动态 loop 天生这么贵"。逐会话剖析证明：**极端劣化里混入了明显的实现缺陷与协议死锁放大**。

- t2 的真实任务工作在第 4 步（约 31 秒）就已完成；其后约 260 秒、17 个 step 全部耗在 Gungnir 协议里——模型在"修 Gungnir"，不是在修用户任务。
- 剥掉缺陷后，干净会话（t5/t6）的纯协议税约为 **2–3×** 量级——小任务面上仍然不回本，Always-on 的死刑判决不变；但它不再是 "+580%" 那个量级。

**稳定结论**：Always-on Gungnir 判死刑（两条独立证据：SwitchBench 否 branch search 默认化；Stage 2 否 adaptive 协议默认化）。**Gungnir 不能成为每个任务都必须经过的"收费站"。** Stage 2 原始数字不能再用来证明"Adaptive Loop 本身很慢"。

## 2. 成本三分解（量化）

| 类别 | 内容 | 实测价格 |
|---|---|---|
| **Verification Tax（必要）** | L1/L2 确定性裁决（harness 侧 `ctx.shell` 跑命令、查 artifact，发生在既有 trip 之间的 round-end） | **≈0 个额外 LLM 往返**（干净会话实测：裁决不产生任何 `assistant/message`）。真正未知的是动态成本 = 干预率 × 干预成本，只有对抗任务能测 |
| **Protocol Tax（该砍）** | submit/plan/report/get_goal/update_goal 的 5–6 个往返下限 + 20k–35k 字符 spec 起草 reasoning + 每步 766 字符指令重注入 + 5/6 会话 schema 重试 | 单独值 **2–3×**（t5/t6 干净会话） |
| **Bug Amplification（必修）** | L4 坏死 + 裁决不回注 + criterion starvation + ledger 考古 + 环境知识缺失 | t2 的 29 步里约 17 步、**65% wall-clock** |

结论：**确定性验证在干净任务上近乎免费；贵的是让 Agent 参与协议。**

## 3. 逐会话剖析（gungnir 组）

| 会话 | steps | reasoning 字符 | 协议往返/工作往返 | 裁决记录 |
|---|---|---|---|---|
| t1 | 10 | 25,957 | 6 / 5 | 6×L1 PASS |
| **t2** | **29** | **91,603** | 9 / **27** | **3×L4 INCONCLUSIVE** |
| t3 | 17 | 31,174 | 11 / 7 | L1 FAIL→修复→全 PASS（VERIFY 生效一次） |
| t4 | 18 | 42,624 | 9 / 17 | 6×L1/L2 PASS |
| t5 | 10 | 11,208 | 6 / 5 | 4× PASS |
| t6 | 8 | 8,077 | 6 / 3 | 2×L2 PASS |

wall-clock 机理：本实验 wall ≈ 输出 token 流式生成时间（实测约 500 字符/秒）。gungnir 组 output tokens 中位 12,220 vs 基线 1,003（约 12 倍），绝大部分是 reasoning 字符——latency +579.9% 主要是**模型在想协议**，不是等工具。真实 input 比离线估计更糟：t2 末轮请求上下文 89.3k tokens（88.6k 走 cache read），29 轮重发形成二次方累积。

## 4. t2：控制平面死锁（Control-plane deadlock）全链

1. sc2 选用 L4 rubric 判据（prompt 明说 prefer lowest level，模型为证明"非硬编码"仍选 L4）。**全实验 L4 共 3 次调用、3 次 INCONCLUSIVE（`unparseable answer`）——该模型+引擎路径下解析率 0/3**（严谨口径：n=3，方向证据与工作块 4 的 engine 路径异常一致，但不称"永久 broken"）。
2. 死锁机制（ledger 事件证实）：round-end 验证只对 committed action 瞄准的判据发裁决——s1 只瞄准 sc2，3 轮只产生 3 条 sc2 裁决；**sc1（L1 exit_code，本可 PASS）从未被验证**（criterion starvation）。reconciler 每轮 RETRY → 重新 commit 同一 s1 → 再 INCONCLUSIVE → `roundsNoImprovement` 0→3 → NEEDS_HUMAN → 模型按纪律调 `update_goal(blocked)`。
3. **裁决细节从不回注模型**：27 条 round 指令全部只说 "0/2 verified PASS (none yet)"——INCONCLUSIVE 的存在与原因模型只能自己挖（epistemic asymmetry）。于是它 grep/read 全局共享的 `gungnir_ledger.json`（单条最高 14.7k 字符，混着其他 session 的 spec），递归列 `$env:DSH_HOME` 两层目录（**单条 50,000 字符工具结果**灌进上下文），并尝试重提 spec v2 被 fold 规则正确拒绝。
4. 环境坑加重混乱：沙箱 `spawn EPERM` 使 `node --test` 必败（SwitchBench §7 已知事实，stage2 prompt 未带注记）；模型手写探针被 PowerShell 双引号 `$1` 变量展开坑成假证据。

**局部自治能力受损的机制（精确）**：committed action 固化（"This round has exactly ONE committed action"）+ 裁决原因不回注 + RETRY 无偏差 allowance，三者叠加把正常环境失败变成控制平面调试。正常 Agent 撞墙后的行为是"读错误 → 换执行方式 → PASS"；协议处境下的模型选择去"搞清楚 harness 为什么不给我 PASS"。**架构倒置警报**：Agent 被迫读取/推理 Gungnir 内部控制状态来恢复正常执行——这是 AP-2 原则（Agent 永不调试 supervisor）的由来。

## 5. t1/t3/t4：spec 起草 deliberation 与 schema 重试

- **巨型 reasoning 块**：t1 step1（44.4s，21,750 字符只为发一条 pwsh）、t3 step3（45.8s，23,621 字符）、t4 step3（70.8s，35,001 字符，占全会话 57%）。三步合计 161 秒纯流式延迟，全部发生在写 GoalSpec 时。
- **5/6 会话首次 `gungnir_submit_spec` 被 Zod 拒绝**：t1 把 `constraints` 传成字符串；t3/t4/t5 把 `verifierLevel` 传成 `"L1"` 字符串而非数字字面量。union 错误 dump 长达 3.3k–5.6k 字符并永久留在上下文。这是每组 validationFailures≥1 的主要来源——**模型在填运行时内部表单，不是在做用户任务**。

## 6. 基线 18 run 行为剖析（standard/ptc/workflow × 6 任务）

**一条直线，失败就地消化，几乎没有过程税**：

- 18 个 run 里**没有任何协议性工具调用**——全部 read/write/edit/glob/grep/pwsh（ptc 组 `run_code`）。任务 3–9 个 step 结束，reasoning 总量 386–8,831 字符，工具结果总吞吐 74–4,364 字符。
- 基线中位 input tokens ~5.6–6.1k **几乎全是固定开销**：每 session 注入约 20.3k 字符 DSH system-prompt snapshot + skill catalog（约 5.5k tokens）；任务文本（工具结果）只占几百到两千 tokens。**基线的成本地板 = DSH 自身注入**，任务面几乎不增加成本。
- 三组性格：standard 常规工具直用、写完即自查（write→read）；ptc 把动作批量打包进 `run_code`（t1 三个文件 2 次调用、读文件 `Promise.all` 并行），往返最少（中位 4）、reasoning 略高；workflow 组 prompt 明示可用 workflow 工具，**6 个任务一次没用**，行为与 standard 同构——**能力存在 ≠ 应该使用**，模型的默认判断是对的（边界：n=6 单 seed 简单任务面，不外推复杂任务）。
- wall-clock 构成：2–3s 进程启动 + 小体量输出生成延迟 + 测试执行本身。全场基线最大单个 reasoning 块 = standard-t2 step 4（6,338 字符 / 12.5s），花在**诊断沙箱 EPERM** 上——基线最大的思考用在解决任务障碍，gungnir 最大的思考用在起草 GoalSpec。

## 7. t2 四组对照：同一堵墙，四种反应

| 组 | 撞墙后的序列 | 代价 |
|---|---|---|
| standard | `node --test`(EPERM) → 重试触发 escalation 拒绝 → `node fmt.test.js` 直跑 PASS → `--test-isolation=none` PASS | 2 个废 trip，2 步内恢复 |
| workflow | `node --test`(EPERM) → **自己查 `node --help` 发现 flag** → PASS | 1 个废 trip |
| ptc | `node --test`(exit 1) → 直跑 PASS → 再试（escalation 拒绝）→ `--test-isolation=none` PASS | 1 个废 trip |
| gungnir | 两次协议循环后才撞墙 → git status（非 git 仓）→ 手写探针被 `$1` 展开坑出假证据 → 递归列 `$env:DSH_HOME`（5 万字符）→ 考古全局 ledger → 重提 spec 被 fold 拒 → 3×report → NEEDS_HUMAN → blocked | **17 个废 trip，从未发现 `--test-isolation=none`** |

**同样的环境失败，基线花 1–2 步，gungnir 花 17 步并最终 blocked。** 差异不在环境，在注意力分配：基线的失败处理是"错误文本就在 tool result 里，下一步就地消化"，没有状态机要求它"回到 committed action"；gungnir 的模型身陷协议处境（committed action 固定为 edit fmt.js、跑测试是 plan 里从未被 commit 的 s2 的事、每步 766 字符指令注入），注意力被锚在"满足协议"而不是"修环境问题"上。

## 8. 公平性的另一面（精确口径）

基线的"0 浪费"有一部分来自**它不做任何验证**：模型自己跑通测试就宣布完成，harness 侧无裁决；任务成败是跑批器在 session 外用确定性谓词判的——等价于 baseline 享受了一个**免费的外部法官**。

**精确口径（直接影响实验设计）**：本实验四组 6/6 全是真完成，runner 法官全程没拦过任何东西（假验收 0）。所以这是**成本记账上的不公平**（baseline 没为验证付费），不是**结果差异**。推论：在诚实任务上"外部法官组 vs 基线组"测不出任何差异（法官闲置）——**对抗任务必须与对照组并入同一 spike**，否则主表全是无效对照。验证的真实价值要用对抗任务测（B4 已证明谎报 claim 在基线形态下不会被拦，gungnir 的 c1 FAIL 拦得住）。

## 9. 可修复缺陷清单与内在成本

| # | 缺陷 | 后果 |
|---|---|---|
| D1 | L4 verifier "unparseable answer"，0/3 解析 | 任何含 L4 判据的 spec 必然死锁到 NEEDS_HUMAN |
| D2 | round-end 裁决细节不回注（只有聚合 "0/2 PASS"） | 直接催生 ledger 考古 |
| D3 | 只验证 committed action 瞄准的判据 | 一个死判据饿死其他可 PASS 判据（criterion starvation） |
| D4 | spec schema 错误是 5.6k 字符 Zod dump | 5/6 会话失败重试，认知税 |
| D5 | 全局 ledger 跨 session 共享（含 `storage`/`storages` 双路径残留） | 上下文污染 |
| D6 | `get_goal` 的 `roundsStarted: 0` 与指令 "round 3" 自相矛盾 | 模型困惑（正文明确写出） |

**内在协议成本**（设计使然，小任务面不回本）：spec 起草 deliberation、约 5–6 个纯协议往返下限、每步指令注入。

**不是问题的**：loop 策略振荡（6 会话只有 t3 触发一次 VERIFY，transition 全部干净）；超时（24/24 无）；质量（6/6 成功、假验收 0——Prove 层门禁在 t2 正确拦下了无法验证的 COMPLETE）。

## 10. 对路线图的输入（已被 ADR-0017 吸收）

1. Stage 2 同时否掉两样东西：**Always-on Adaptive Loop** 与 **Always-on Explicit Goal Protocol**（后者可能更重要——烧 token 的主项是 spec/commit/report/verdict/round 仪式，不是策略切换）。
2. 下一主假设 = **Passive Proof**：被动观察 + 静默验证 + 证据介入，Agent 无感知。好消息：大部分已建成——一阶段 dsh-gungnir 插件（evidence 捕获 + L1/L2 verifier）本就在默认 driver 上跑，passive 形态 = 现役回退形态 + 关掉指令注入 + 加 wrapup 钩子，不造新轮子。
3. 架构原则 AP-1～AP-6。其中"锁目标不锁手脚"（AP-5）是对铁律 6（Goal 稳定，Strategy 多变）与 ADR-0013 ⑥（Default-to-cheap）的**执行修正**——t2 证明 v0 实现违背了已冻结原则的精神（plan 约束了现实），不是方向变更。
4. 处置：L4 禁用（口径见 §4.1；独立 benchmark 证成前不得恢复）；GoalSpec 改渐进式形式化；`packages/agent-loop` 等重型策略冻存为 escalation 后端资产——**Branch Search 回流是未测假设**（ADR-0013 刚判它小任务面不回本；罕见触发 backend 与默认策略是不同成本结构，须测量，不当作已兑现的资产复用）；不重跑 Stage 2。
5. **遗留核心设计问题：passive 模式的判据来源**——通用不变量（真 0-cost 但 recall 有限）/ 一次性轻量捕获（session 开头 1 个额外 trip）/ 外部供给（最干净，但吃 runner 手写判据会让 C2 退化成 C1+监听）。作为 Passive Proof Spike 的第一预注册问题，C2 按判据来源分层（C2a/C2b）。干预触发器走**结构事件**（适配点② wrapup seam，时序已实测），严禁文本挖掘模型"我完成了"（Let It Go 禁区）。
