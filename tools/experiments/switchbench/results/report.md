# SwitchBench v0 实验报告（Day 7）

> H1 判决：**Some practically useful agent-loop topologies cannot be cleanly represented as strategies inside a single adaptive driver without material loss of performance, efficiency, or architectural simplicity.**
> 数据：`stage1-2026-08-28T17-54-01-597Z`（stage 1，15 rows）。冻结口径见 [EXPERIMENT.md](EXPERIMENT.md) §7/§8 与 [BENCHMARK.md](BENCHMARK.md)（含 §7 冻结修正事故 #5：600s 统一预算）。

## Scorecard（EXPERIMENT.md §7 九项 + Gate 3 补充口径）

| 类别 | 指标 | baseline | A (Strategy) | B (Handoff) |
|---|---|---|---|---|
| 目标 | Verified Goal Completion Rate | 100% | 100% | 100% |
| 可靠 | False Completion Rate | 0/5 | 0/5 | 0/5 |
| 成本 | Input Tokens / Verified Success | n/a¹ | 81304 | 140609 |
| 速度 | Wall Time / Verified Success (s) | 89.4 | 249.8 | 185.4 |
| 行动力 | TTFUA (s, all runs) | 11.7 | 16.4 | 2.9 |
| 效率 | LLM Round Trips / Verified Success | 9.4 | 27.4 | 43.0 |
| 纪律 | Waste Ratio | 0.16 | 0.55 | 0.64 |
| 测试 | Test Recall | 1.00 | 1.00 | 1.00 |
| 测试 | Test Precision | 0.85 | 0.85 | 0.85 |
| 遵循 | Constraint Violation Runs (integrity/exports) | 0 | 0 | 0 |
| 遵循 | Unsupported Claim Rate (行为口径²) | 0% | 0% | 0% |

¹ Baseline token = session log 载荷重建 × A/B 校准比的离线估计（下界放大，方法误差见附录）；A/B 为 API usage 实测。
² Unsupported Claim 的操作化为纯行为口径：声明完成但无成功的测试套件执行记录；不做文本语义判断（Let It Go）。

## 三级 Gate 判定（§8 冻结线）

### Gate 1（一票否决）

- VGCR：baseline 100%（5/5）｜A 100%（5/5）｜B 100%（5/5）
- 一票否决线（B 的 VGCR 比 A 低 >5pp）：未触发

### Gate 2（成功之后比效率；per verified success）

| 指标 | A | B | B 相对改善 | ≥20%？ |
|---|---|---|---|---|
| Input Tokens / Verified Success | 81303.8 | 140608.6 | -73% | ✗ |
| LLM Round Trips / Verified Success | 27.4 | 43.0 | -57% | ✗ |
| Wall Time / Verified Success | 249.8 | 185.4 | 26% | ✓ |
| Time to First Useful Action (s) | 16.4 | 2.9 | 82% | ✓ |

- B 继续投资的效果优势条件（VGCR +10pp 或 ≥2 项效率 ≥20% 改善）：VGCR 无 ≥10pp 优势；效率 ≥20% 改善项数 = 2

### Gate 3（Execution Discipline）

- False Completion：A 0 vs B 0（不多于 A 才算过）
- Waste Ratio：A 0.55 vs B 0.64（不升才算过）
- Test Recall：A 1.00 vs B 1.00（不降才算过）
- Gate 3 综合判定：劣化

### §8 结论（stage 1 样本 = 5 任务 × 1 seed）

- **B 获得继续投资资格：否**。
- 命中的停止线（§8）："B 效率稍好，但 … Gate 3 纪律劣化：理论收益盖不住系统复杂度"（waste 0.55 → 0.64 上升；token/success 反向 +73%）
- 架构条件与第三结局（Strategy API 膨胀 → LoopModule）的评估见附录 A 的 A 变形成本计数。
- 样本 5 任务（20pp/任务粒度）；architecture 条件由源码结构计数与牺牲语义清单人工评定（见附录）

## Day 6 决策：Stage 2 是否执行

- §6 分支判定：A/B **有**实质差异（非"无差异"）——B 在 wall（-26%）与 TTFUA（-82%）上显著占优、在 tokens/success（+73%）与 waste（+0.09）上显著居劣。
- 但 §8 三级 Gate 顺序裁决已在 Stage 1 数据上得出停止判决（上一节），Stage 2（10 任务 × 2 seeds = 60 runs）的"固化正向信号"前提不成立：B 的两项效率赢来自其结构（交接后轻上下文起步），其 token/waste 劣势同样来自结构（分支独立上下文的隔离成本 + 交接后重建），更多样本不会改变方向。
- **决定：Stage 2 不执行**。不确定性（n=5、waste 二值判据、单 seed）如实记录于 ADR；若后续阶段要在更大任务面重开 B，按本实验冻结口径扩容重跑即可（任务/判据全部可复用）。

## 综合判词：三个直接问题的答案（ADR-0013 的推理主线）

> 本节把 Scorecard、三级 Gate 与附录数据综合成三个直接问题的一问一答，是 ADR-0013 判决的支撑论证，也是二阶段 router v0 的首个校准输入。

**裁决分两层，不能混读**：架构裁决（H1：异构 Loop 拓扑能否干净 Strategy 化）→ 方案 A 胜、方案 B 停止投资；产品性能裁决（当前这个 A 的 BranchSearchStrategy 实现 vs 普通 DSH）→ 普通 DSH 才是这批小任务的性能冠军。所以下一步不是"继续优化 Branch Search"，而是做真正的 Adaptive Loop Runtime / Router：默认保持普通 DSH 的轻量路径，只有检测到确实需要升级时才切更重的 Strategy。

**Q1：A 是不是弱于普通 DSH？——在本实验任务面上，是的，全面弱于。**

5 任务 × 3 架构全部 100% 修复成功（质量指标完全打平：0 假完成、0 约束违规、相同测试召回），所以差异全在成本侧：

| 指标（per verified success） | 普通 DSH | A（Strategy） | B（Handoff） |
|---|---|---|---|
| Wall / 成功 | 89.4s | 249.8s（**2.8×**） | 185.4s（2.1×） |
| Input tokens / 成功 | ≈59k（离线估计¹） | 81.3k（1.45×） | 140.6k（**2.5×**） |
| LLM 往返 / 成功 | 9.4 | 27.4（2.9×） | 43.0（**4.6×**） |
| Waste Ratio | 0.16 | 0.55 | 0.64 |
| TTFUA（首动作延迟） | 11.7s | 16.4s | **2.9s**（唯一亮点） |

¹ baseline token 为 session log 重建 × 校准比（附录 B，0.712）的离线估计，有误差带宽；A/B 为 API usage 实测。

**Q2：B 和普通 DSH 比？——更弱（除了"第一动作延迟"一项）。** B 的 TTFUA 2.9s 与 wall 185.4s（比 A 快 26%）是交接后空上下文起步带来的结构性收益，但代价同样来自结构：分支独立上下文的隔离成本 + 交接后重建（tokens/success +73%、rounds/success +57%、waste 0.64 全场最高）。质量打平的前提下理论收益盖不住成本——§8 冻结线"理论收益盖不住系统复杂度"命中，B 停止投资（ADR-0013）。

**Q3：是否应该开发 A？——分两层：不应开发的是"BranchSearchStrategy 这个策略本身"；但实验反而支持继续开发 A 所代理的那个东西（Adaptive Loop Runtime + 路由）。这两件事要分开。**

### 为什么 branch search 输得这么干净：结构性，不是实现差

三架构质量指标完全打平，所以差异不是实现质量，而是结构性的：5 个任务都是单模块小 bug，普通 ReAct 读两三个文件就能定位；branch search 却要先枚举假设、再开 3–4 个独立分支会话各查一遍——固定开销（枚举 + 每分支独立上下文重发）在小任务上永远收不回本。waste 0.55/0.64 高主因就是各分支重复读同样的文件，这是隔离语义的代价，不是模型犯错。

### 是否开发 A：两层结论

- **BranchSearchStrategy 本身：不开发为默认策略。** 数据说得很清楚：小任务上它是纯赔本。它未来唯一可能的出场方式，是作为路由器在"任务状态确实卡死 / 高不确定"时才切的重型策略——触发条件必须比"默认开启"保守得多。这次的成本结构就是它的定价依据。
- **A 所代理的架构（UnifiedDriver + strategy host）：实验是给它投了赞成票的。** 本实验的真正目的（EXPERIMENT.md §1）不是证明 branch search 有用，而是裁决 H1——"最难 Strategy 化的拓扑能不能干净塞进统一 driver"。结果：能（5/5 成功、共享基座零 branch 特判，代价是 4 项 driver core 原语，全部计量在案，见附录 A），而 B 的薄交接在质量打平的前提下成本反而更高。这就是 ADR-0013 的判决：**方案 A 路线胜出，B 停止投资**。

### 对二阶段 M1 的输入：router 的第一个校准点

二阶段真正要开发的 FAST / EXECUTE / VERIFY + 路由，恰好是"默认用便宜策略、有证据才升级"的设计——本次数据等于给路由器提供了第一个校准点：**在小型单模块任务面上，正确的路由就是"别升级"**，baseline（普通 ReAct）就是最优解，切重型策略只会引入固定开销。这与 baseline 的行为一致，也直接支撑 router v0（二阶段计划 §3.4）"默认不切"的倾向。

**一句话总结**：普通 DSH 在小任务面上就是最优解，这恰恰说明 Gungnir 的价值不在"总是换更复杂的 loop"，而在"知道什么时候不该换"——即路由 + hysteresis，这正是二阶段 M1 要做的东西。

**最值钱的一条数据**：Baseline 89.4s vs A 249.8s，三者成功率却都是 100%——它非常清楚地说明：智能 Agent Runtime 最大的智慧之一，就是知道什么时候什么都别加。

### Scope 限定与重开路径

SwitchBench 的 scope 限定（小型单模块任务面、n=5、单 seed）如实随档，本判词不外推到调查维度占主导的大型多模块任务面。若未来要在大型任务面重开 branch search 或 B，冻结的任务 / 判据 / runner 全部可复用（EXPERIMENT.md §6 Stage 2 扩容口径）。

严谨结论边界：当前证据（5 小型单模块任务 × 1 seed，baseline token 为离线估计非 API 实测）足以停止 B 的近期研发，但不足以永久否证所有 Physical Loop Switching 场景。重开 B 仅限三条件（证伪即重开，ADR-0013 修订第 9 条）：新 Loop 无法利用 D1–D4 等通用原语干净 Strategy 化；或 Strategy 化后产生明确质量/成本损失；或需要真正独立生命周期/故障隔离。

## 关键观察（判词之外的事实）

- **Baseline（普通 ReAct）在全部效率指标上占优**（wall 89.4s vs 249.8/185.4s，rounds 9.4 vs 27.4/43.0），且 VGCR 同为 100%。本案 5 个任务均为单模块小型定位修复，branch search 的固定开销（枚举 + N 分支独立调查）在该任务规模不回本。**结论限定**：这否证的是"branch search 在小型任务面上的净收益"，不是"Strategy 化路线"本身（EXPERIMENT.md §1 选 Branch Search 是因为它最难 Strategy 化，不是因为它是常用拓扑）。
- **waste 的结构含义**：A/B 的高 waste（0.55/0.64 vs baseline 0.16）主要由分支会话各自独立读文件贡献——这是 branch search 隔离语义的结构性代价（EXPERIMENT §7 的"重复读未变文件"按 run 级口径计），在 A/B 之间对称计入，不偏置判决。
- **B 的 wall 赢法**：交接后执行控制器以空上下文 + 8 字段包起步，转向快（TTFUA 2.9s）、执行段短；代价是 token/轮次的重建开销（tokens/success +73%、rounds/success +57%）。这正是"Loop ≈ Runtime Resource"的收益/代价形状，与 §1 的口头论证一致。
- **B 的 t01 枚举降级**：首轮 t01-B 枚举未产出可解析 JSON（降级路径接管，仍 PASS）；重跑轮枚举成功。降级路径两架构各触发过一次，均如实落账。


## 附录 A：架构指标（H1 专属）

### A 的强行适配成本（源码结构计数）

```
{
 "strategy-host.mjs": 73,
 "branch-search-strategy.mjs": 235
}
{
 "unified-driver.mjs": 155,
 "workspace-tools.mjs": 269
}
```

- D1 driveTurn 钩子（strategy 接管 turn 循环；strategy-host.mjs 的 runWithStrategy）
- D2 sub-conversation 原语（私有上下文子 driver；openSubconversation）
- D3 工具面过滤（unified-driver advertiseTools + workspace-tools allowedTools，[deformation] 登记）
- D4 共享观察态（workspace-tools sharedState，多执行器共享纪律观察与记账）
- 共享基座中的 branch 特判数（grep `branch_`）：0
- 被迫牺牲/引入的语义：
  - 分支隐私上下文必须经 driver 新原语（D2）才可获得——基座物理规律 1 本身没有多上下文
  - 分支内工具面收窄需要 D3 过滤机制——基座工具注册表原本无 per-phase 概念
    - strategy 与执行的记账统一依赖 D4——否则 A 的指标口径碎裂

> **双读注记（工作块 14，ADR-0013 修订第 8 条）**：这 4 项也可读作"Adaptive Runtime 的最小通用 ISA"而非纯变形成本——driveTurn 让不同 Strategy 自控一段认知流程；sub-conversation 提供隔离工作记忆（debate / critic / parallel-hypothesis / specialist 都可能用）；tool filtering 让不同认知阶段看到不同工具（FAST / EXECUTE / VERIFY / RESEARCH 均受益）；shared observation 在 Strategy 间共享客观执行事实而非全部 reasoning history（与 Claim ≠ Evidence 天然吻合）。"膨胀信号"与"Kernel 雏形"两读并存，n=1 种 Loop 证据不足，不作单边判读，三阶段重估。

### B 的交接税（HandoffPacket 薄交接）

| task | packet bytes | selected 为空 | verified_facts | unresolved | 执行阶段重读分支已读文件 | Gate1 |
|---|---|---|---|---|---|---|
| t01 | 2543 | 否 | 3 | 3 | 0 | PASS |
| t02 | 2805 | 否 | 5 | 3 | 0 | PASS |
| t03 | 3731 | 是 | 11 | 4 | 0 | PASS |
| t04 | 3830 | 否 | 6 | 3 | 0 | PASS |
| t05 | 2668 | 否 | 4 | 3 | 0 | PASS |

## 附录 B：token 口径与校准

- A/B 校准比（估计/实测，跨请求平均）：0.712（payload 不含 tools schema；baseline 重建同样不含 system prompt 与工具 schema → 校准比近似补足同族缺口）
- baseline t01: raw 104571 tok → 校准后 74447 tok（offline official tokenizer (chat_template), raw sum × calibration 0.712）
- baseline t02: raw 48751 tok → 校准后 34707 tok（offline official tokenizer (chat_template), raw sum × calibration 0.712）
- baseline t03: raw 89561 tok → 校准后 63761 tok（offline official tokenizer (chat_template), raw sum × calibration 0.712）
- baseline t04: raw 96466 tok → 校准后 68677 tok（offline official tokenizer (chat_template), raw sum × calibration 0.712）
- baseline t05: raw 72859 tok → 校准后 51871 tok（offline official tokenizer (chat_template), raw sum × calibration 0.712）


## 附录 C：单 run 明细

### stage1-2026-08-28T17-54-01-597Z

| task | arch | Gate1 | finish | wall s | in tok | out tok | rounds | tools | waste | ttfua s | recall | precision | src changed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| t01 | baseline | PASS | n/a | 153.9 | n/a | n/a | 11 | 18 | 0.17 | 24.6 | 1.00 | 0.83 | 1 |
| t01 | a | PASS | finish-tool | 471.8 | 64303 | 9127 | 16 | 35 | 0.46 | 24.7 | 1.00 | 0.83 | 1 |
| t02 | baseline | PASS | n/a | 58.9 | n/a | n/a | 6 | 12 | 0.08 | 6.4 | 1.00 | 0.88 | 1 |
| t03 | baseline | PASS | n/a | 81.4 | n/a | n/a | 10 | 16 | 0.13 | 12.2 | 1.00 | 0.92 | 1 |
| t03 | a | PASS | finish-tool | 163.2 | 80982 | 11376 | 29 | 60 | 0.58 | 11.3 | 1.00 | 0.92 | 1 |
| t04 | baseline | PASS | n/a | 73.6 | n/a | n/a | 11 | 16 | 0.25 | 5.9 | 1.00 | 0.88 | 1 |
| t04 | a | PASS | no-tool-calls | 214.3 | 53406 | 8346 | 17 | 31 | 0.42 | 15.1 | 1.00 | 0.88 | 1 |
| t05 | baseline | PASS | n/a | 79.3 | n/a | n/a | 9 | 15 | 0.20 | 9.4 | 1.00 | 0.73 | 1 |
| t02 | a | PASS | finish-tool | 188.7 | 80948 | 12204 | 34 | 68 | 0.69 | 21.8 | 1.00 | 0.88 | 1 |
| t05 | a | PASS | finish-tool | 211.1 | 126880 | 17137 | 41 | 77 | 0.61 | 9.2 | 1.00 | 0.73 | 1 |
| t01 | b | PASS | no-tool-calls | 269.5 | 188716 | 19644 | 49 | 100 | 0.62 | 4.4 | 1.00 | 0.83 | 1 |
| t02 | b | PASS | finish-tool | 136.0 | 96054 | 14592 | 35 | 76 | 0.70 | 0.9 | 1.00 | 0.88 | 1 |
| t03 | b | PASS | finish-tool | 175.9 | 184760 | 16960 | 50 | 91 | 0.57 | 4.0 | 1.00 | 0.92 | 1 |
| t04 | b | PASS | finish-tool | 174.6 | 131812 | 16529 | 42 | 83 | 0.65 | 1.6 | 1.00 | 0.88 | 1 |
| t05 | b | PASS | finish-tool | 171.1 | 101701 | 15236 | 39 | 75 | 0.67 | 3.7 | 1.00 | 0.73 | 1 |


## 附录 D：B 组 HandoffPacket 原文

### 1/t01

```json
{
  "goal_spec": {
    "goal": "make the repository's test suite pass, conforming to README.md as the authoritative spec",
    "constraints": [
      "only-src",
      "no-new-deps",
      "api-stable",
      "stay-in-workspace"
    ]
  },
  "goal_status": {
    "phase": "branch-search-complete",
    "hypotheses_investigated": 4,
    "selection": "rank confirmed>inconclusive, then evidence count; selected h1 (confirmed, 3 evidence items)"
  },
  "selected_hypothesis": "h1: applyCoupon computes the coupon discount per line (summing roundHalfUpCents(lineNet * rate / 100) over priced.lines) instead of exactly once on the whole discounted subtotal as specified (roundHalfUpCents(discountedSubtotal * rate / 100)); per-line rounding makes the multi-line results 124 (53+71) and 858 (53+756+49) instead of 123 and 857.",
  "verified_facts": [
    "src/coupons.js lines 8-13 compute couponDiscount via `priced.lines.reduce((sum, line) => sum + roundHalfUpCents((line.lineNet * ratePercent) / 100), 0)`, i.e. rounding per line, not once on the whole discounted subtotal as README step 4 requires",
    "Node check: applyCoupon(priceLines([{id:'a',unitPriceCents:250,qty:3},{id:'b',unitPriceCents:202,qty:5}]), 7) returns couponDiscount 124 (per-line 53+71), while roundHalfUpCents(1760*7/100) = roundHalfUpCents(123.2) = 123, matching the hypothesis's predicted 124 vs 123",
    "npm test fails test/coupons.test.js:15 with '124 !== 123' and test/checkout.test.js:17 with '858 !== 857'; the checkout failure matches the hypothesis's predicted per-line sum 53+756+49 = 858 vs whole-subtotal-once 857"
  ],
  "evidence_refs": [
    "branch-report:h1"
  ],
  "artifact_refs": [
    "src/coupons.js"
  ],
  "unresolved_questions": [
    "h2: investigation report missing",
    "h3: refuted — The coupon percentage math applies an intermediate rounding or truncation (e.g., rounding discountedSubtotal*rate before dividing by 100, or doing an integer/floor division at a middle step) so that even the whole-subtotal formula yields 858 for 12243 and 124 for 1760; the defect would be in the order of operations inside applyCoupon, not in per-line aggregation.",
    "h4: refuted — priceLines returns lineNet and discountedSubtotal that are inconsistent (e.g., lineNet rounded per line and discountedSubtotal summing rounded lineNets, or discountedSubtotal computed from lineGross before subtracting discount), so applyCoupon and applyTax consume a distorted base even if their own math is spec-correct; the defect is upstream in the pricing stage."
  ],
  "recommended_next_action": "Fix the confirmed root cause (src/coupons.js) under src/ per the README spec, then run the test suite to verify."
}
```
### 1/t02

```json
{
  "goal_spec": {
    "goal": "make the repository's test suite pass, conforming to README.md as the authoritative spec",
    "constraints": [
      "only-src",
      "no-new-deps",
      "api-stable",
      "stay-in-workspace"
    ]
  },
  "goal_status": {
    "phase": "branch-search-complete",
    "hypotheses_investigated": 4,
    "selection": "rank confirmed>inconclusive, then evidence count; selected h1 (confirmed, 5 evidence items)"
  },
  "selected_hypothesis": "h1: src/keys.js `normalizeKey` folds case by calling `key.trim().toLowerCase()`, so keys that differ only in case collapse onto the same Map entry. This directly violates the README rule 'case is significant' and explains all three failures (the two keys tests and the case-collision cache test, where set('Alpha') is overwritten by set('alpha')).",
  "verified_facts": [
    "src/keys.js line 6: `return key.trim().toLowerCase()` — normalization folds case, directly contradicting README 'Case is significant: two keys that differ only in case are two distinct entries'",
    "Direct call: `node -e \"import('./src/keys.js')...\"` printed {\"input\":\"Alpha\",\"output\":\"alpha\"}, so normalizeKey('Alpha') returns 'alpha' instead of 'Alpha'",
    "`npm test` reports 3 failures: 'keys: case is significant after trim' (test/keys.test.js:5-6, actual 'alpha' !== expected 'Alpha'), 'keys: trims surrounding whitespace' (test/keys.test.js:10-11, actual 'gamma' !== expected 'Gamma'), and 'cache: keys that differ only in case are distinct entries' (test/cache.test.js:11-16, 'B' !== 'A' at line 15)",
    "src/cache.js uses normalizeKey for both set and get (lines 15, 22), so set('Alpha') and set('alpha') collapse onto the same Map entry — explaining the cache test failure and size() returning 1 instead of 2",
    "Passing tests are exactly those not involving case (5 pass, 3 fail), consistent with the case-fold being the sole cause"
  ],
  "evidence_refs": [
    "branch-report:h1"
  ],
  "artifact_refs": [
    "src/keys.js",
    "src/cache.js"
  ],
  "unresolved_questions": [
    "h2: refuted — src/cache.js `set`/`get` perform their own extra case fold (e.g. `normalizeKey(key).toLowerCase()` or lowercasing before using the Map key), so entries are stored and looked up case-insensitively even though `normalizeKey` itself may be correct — a second, independent normalization layer in the cache.",
    "h3: investigation report missing",
    "h4: refuted — The key normalization contract is applied inconsistently: the public `normalizeKey` is imported but `createCache`'s `has`/`get`/`set` don't all share the same normalized form (e.g. `set` stores under the raw key or a separately folded key while `get` folds differently), so lookups collide across case boundaries even if the single-function behavior is fine."
  ],
  "recommended_next_action": "Fix the confirmed root cause (src/keys.js, src/cache.js) under src/ per the README spec, then run the test suite to verify."
}
```
### 1/t03

```json
{
  "goal_spec": {
    "goal": "make the repository's test suite pass, conforming to README.md as the authoritative spec",
    "constraints": [
      "only-src",
      "no-new-deps",
      "api-stable",
      "stay-in-workspace"
    ]
  },
  "goal_status": {
    "phase": "branch-search-complete",
    "hypotheses_investigated": 4,
    "selection": "none"
  },
  "selected_hypothesis": "",
  "verified_facts": [
    "src/csv.js:6-12 renderField wraps text in quotes via `\"${text}\"` when /[,\"\\n\\r]/ matches but contains no quote-doubling replacement; full workspace file walk (package.json, README.md, src/csv.js, src/dates.js, src/export.js, src/rows.js, test/*.test.js) found no other source files",
    "The only .replace() in the codebase is src/rows.js:14 `String(whole).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')` (thousands grouping); there is no `.replace(/\"/g, '\"\"')` or any quote-doubling escape anywhere in the pipeline",
    "npm test output: actual 'A,B\\n\"He said \"hi\"\",y' vs expected 'A,B\\n\"He said \"\"hi\"\"\",y' (test/csv.test.js:16) and export test actual 'A-1,\"He said \"hi\"\",\"12,345.67\",...' vs expected 'A-1,\"He said \"\"hi\"\"\",...' (test/export.test.js:18) — the row value's internal quotes reach output undoubled because doubling code is absent, not mis-targeted",
    "Hypothesis h2 presupposes a quote-doubling escape exists but targets the wrong operand; positive inspection of every source file shows no such escape exists, so the precondition is contradicted",
    "src/csv.js renderField wraps with `\"${text}\"` (line 9) and contains no quote-doubling replace; there is no doubling step to be mis-gated",
    "node run: toCsv([{a:'a,\"b\"'}]) → 'A\\n\"a,\"b\"\"' — comma+quote field wrapped but quotes NOT doubled",
    "node run: toCsv([{a:'\"c\"'}]) → 'A\\n\"\"c\"\"' — quote-only field wrapped but quotes NOT doubled",
    "wrap condition /[\",\\n\\r]/ already includes the double quote, so quoting is not the issue; failing test actual 'He said \"hi\"' vs expected 'He said \"\"hi\"\"' shows doubling absent entirely",
    "src/csv.js lines 6-10: renderField wraps text in quotes but contains no .replace() call at all — the regex /[\",\\n\\r]/ is used only for the quoting test, so no doubling (global or first-match) is attempted",
    "node --test test/csv.test.js: actual output 'A,B\\n\"He said \"hi\"\",y' vs expected 'A,B\\n\"He said \"\"hi\"\"\",y' shows zero internal quotes doubled, not partial doubling",
    "node -e probe with field 'a\"b\"c' emitted '\"a\"b\"c\"' (zero doubled quotes), whereas h4 predicted a partially-doubled cell like '\"a\"\"b\"c\"'"
  ],
  "evidence_refs": [],
  "artifact_refs": [],
  "unresolved_questions": [
    "h1: investigation report missing",
    "h2: refuted — A quote-doubling escape exists in the pipeline but operates on the wrong target — e.g., it is applied after the field has already been wrapped (escaping the outer wrapper quotes instead of the inner content), or applied to `column.name`/the key rather than to `row[column.key]` — so the row value's internal quotes reach the output undoubled.",
    "h3: refuted — The doubling step is gated behind an incorrect condition, e.g. it runs only for fields that also contain `,` or `\\n`/`\\r` (the comma/newline branch) and not for a field whose only special character is `\"` — so a quote-only field gets wrapped without its quotes being doubled.",
    "h4: refuted — The doubling is implemented with a non-global or first-match-only replacement (e.g. `replace(/\"'/, '\"\"'`) or a malformed quote class) so only one of several internal quotes gets doubled, leaving at least one unescaped quote per cell and producing the observed `\"He said \"hi\"\"` style output."
  ],
  "recommended_next_action": "No hypothesis survived investigation. Investigate the failing suite directly, fix the root cause under src/, then run the suite."
}
```
### 1/t04

```json
{
  "goal_spec": {
    "goal": "make the repository's test suite pass, conforming to README.md as the authoritative spec",
    "constraints": [
      "only-src",
      "no-new-deps",
      "api-stable",
      "stay-in-workspace"
    ]
  },
  "goal_status": {
    "phase": "branch-search-complete",
    "hypotheses_investigated": 4,
    "selection": "rank confirmed>inconclusive, then evidence count; selected h4 (confirmed, 6 evidence items)"
  },
  "selected_hypothesis": "h4: The pipeline (runOrder/queue.enqueue) enqueues parseTask's output unmodified and the queue stores tasks as-is, so nothing between parsing and comparison enforces the README interaction rule that priorities flow as integers — raw string priorities reach the comparator. The scheduler failure is caused by this missing normalization/type-invariant step rather than by the sort logic itself (queue.js slicing, seq tie-break, and drain non-mutation are all correct).",
  "verified_facts": [
    "src/parse.js:11-12 returns `{ id: payload.id, priority: trimmed }` — priority stays a string; no Number.parseInt(trimmed, 10) conversion and no RangeError/TypeError validation, so parsed tasks are not integers per README spec",
    "src/scheduler.js:7 `queue.enqueue(parseTask(payload))` enqueues parseTask's output unmodified — no normalization/type-invariant enforcement between parsing and enqueue",
    "src/queue.js:9 `items.push({ task, seq: nextSeq++ })` stores the task as-is; drain uses `slice().sort(compare || seq).map` — observed queue tests for FIFO ties and drain non-mutation pass, so the sort logic itself is not the culprit",
    "Wrapper instrumentation: tasks observed at enqueue time are `[{\"id\":\"a\",\"priority\":\"2\"},{\"id\":\"b\",\"priority\":\"10\"}]` with `typeof priority === 'string'` for both, and `drain()` for those returns `[\"b\",\"a\"]` (lexicographic '10'<'2'), proving raw strings reached the comparator",
    "Direct probe: `runOrder([{id:'a',priority:'2'},{id:'b',priority:'10'},{id:'c',priority:'1'}])` returns `[\"c\",\"b\",\"a\"]` (lexicographic 1,10,2) instead of `[\"c\",\"a\",\"b\"]` (numeric 1,2,10), exactly as the hypothesis predicted",
    "Test run: 4 failures — 3 in parse.test.js (parseTask returns string '10' not number 10; no RangeError on 'soon'/' -3 ') and 1 in scheduler.test.js (digit-width ordering); the 3 passing scheduler/queue tests (FIFO ties, mixed single-digit, drain non-mutation) confirm queue.js/compare logic is sound"
  ],
  "evidence_refs": [
    "branch-report:h4"
  ],
  "artifact_refs": [
    "src/parse.js",
    "src/scheduler.js"
  ],
  "unresolved_questions": [
    "h1: confirmed — parseTask returns the trimmed priority string verbatim instead of converting it to a non-negative integer with radix 10 (it does `priority: trimmed` rather than `priority: Number(trimmed)` / `parseInt(trimmed, 10)`), so the parsed task's priority keeps type 'string'. This directly breaks the parse test that deep-equals `priority: 10` and lets string values flow downstream.",
    "h2: confirmed — parseTask performs no validity check on the trimmed priority, so non-numeric strings like 'soon' and negative strings like '-3' do not throw RangeError (no `/^\\d+$/` guard, no Number.isInteger check). This is a separate defect from conversion: even a numeric-converting implementation without a guard would accept 'soon'.",
    "h3: confirmed — compare() uses relational operators (`<`, `>`) without numeric coercion, so when the priority reaches it as a string (as parseTask currently produces) the comparison is lexicographic: `compare({priority:'10'},{priority:'2'})` returns -1, making '10' sort before '2'. The scheduler's numeric ordering contract ('lower number first', where 2 < 10) is thus violated at the comparator even though compare's logic is 'correct' for true integers."
  ],
  "recommended_next_action": "Fix the confirmed root cause (src/parse.js, src/scheduler.js) under src/ per the README spec, then run the test suite to verify."
}
```
### 1/t05

```json
{
  "goal_spec": {
    "goal": "make the repository's test suite pass, conforming to README.md as the authoritative spec",
    "constraints": [
      "only-src",
      "no-new-deps",
      "api-stable",
      "stay-in-workspace"
    ]
  },
  "goal_status": {
    "phase": "branch-search-complete",
    "hypotheses_investigated": 4,
    "selection": "rank confirmed>inconclusive, then evidence count; selected h1 (confirmed, 4 evidence items)"
  },
  "selected_hypothesis": "h1: matchesAnySegment performs substring containment (String.prototype.includes / indexOf / regex) instead of full-string equality, so a user segment like 'beta-testers' falsely matches the configured segment 'beta'.",
  "verified_facts": [
    "src/segments.js line 7 implements matching as `segmentNames.some((segment) => user.segments.some((own) => own.includes(segment)))`, i.e. String.prototype.includes (substring containment), not full-string equality as required by README ('Substring or partial matching is a specification violation')",
    "node --input-type=module run of `matchesAnySegment({segments:['beta-testers']}, ['beta'])` printed `true`; spec requires `false`",
    "node --test test/segments.test.js fails at 'segments: matching is exact full-string equality' with AssertionError: '\"beta\" must not substring-match \"beta-testers\"', actual true !== expected false (test/segments.test.js:7)",
    "node --test test/flags.test.js fails at 'flags: segment membership decides over rollout, by exact match only' (test/flags.test.js:12): evaluate returns {enabled: true, reason: 'segment'} for user segments ['beta-testers','staff'] vs flag segments ['beta']; expected {enabled: false, reason: 'segment-not-matched'} — same root cause via flags.js calling matchesAnySegment"
  ],
  "evidence_refs": [
    "branch-report:h1"
  ],
  "artifact_refs": [
    "src/segments.js"
  ],
  "unresolved_questions": [
    "h2: refuted — matchesAnySegment reverses the comparison operands, checking whether each configured segment name contains any user segment (e.g. `segment.includes(own)` instead of `own === segment`), which produces false positives whenever a user segment is a substring of a configured name.",
    "h3: refuted — matchesAnySegment normalizes inputs before comparing (e.g. toLowerCase/toUpperCase/trim), violating the spec's case-sensitive, exact-equality contract and causing near-but-not-equal segments to match.",
    "h4: refuted — evaluate in flags.js does not delegate segment matching to matchesAnySegment (or passes wrong arguments), inlining its own substring/partial matching logic so a segment-configured flag is enabled even when no exact segment matches."
  ],
  "recommended_next_action": "Fix the confirmed root cause (src/segments.js) under src/ per the README spec, then run the test suite to verify."
}
```
