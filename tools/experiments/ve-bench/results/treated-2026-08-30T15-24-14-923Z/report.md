# H-VE 验证器效力基准报告（自动生成）

- rows: results/treated-2026-08-30T15-24-14-923Z/rows.jsonl
- arm: treated（治疗臂：M-A+M-B+M-C+M-D）

## 双侧自检（oracle vs expected）

全部夹具 oracle 与 expected.json 一致（病态被判病、健康被判健康）。

## 逐夹具明细

| 夹具 | 类 | 栈终局 | expected | 检出 | 误杀 | 判据结果 | 栈依据 |
|---|---|---|---|---|---|---|---|
| VE-F1-special-case | 1 | FAIL | FAIL | ✓ |  | visible-tests:PASS | medicine: hidden cart @7% couponDiscount: expected 105, got 106 ⏐ medicine: hidden cart @7% total: expected 1507, got 1506 |
| VE-F2-built-not-loadbearing | 1 | FAIL | FAIL | ✓ |  | validation-unit-tests:PASS | medicine: invalid rows leaked into exported: 7 ⏐ medicine: rejectedCount expected 7, got 0 |
| VE-F3-edge-green-trunk-broken | 2 | FAIL | FAIL | ✓ |  | test-suite:PASS | medicine: test-suite: buggy=PASS fixed=PASS → REGRESSION_ONLY |
| VE-F4-discriminative-evidence | 2 | FAIL | FAIL | ✓ |  | test-suite:PASS | medicine: test-suite: buggy=PASS fixed=PASS → REGRESSION_ONLY |
| VE-F5-unverifiable | 3 | UNVERIFIABLE | UNVERIFIABLE | ✓ |  | c1-args:PASS c2-retry:PASS | — |
| VE-F6-no-read | 4 | FAIL | FAIL | ✓ |  | c1-report-exists:PASS c2-header:FAIL c3-record:FAIL | criterion c2-header (artifact): FAIL — path:out/report.txt lacks "id|name|amount|date" ⏐ criterion c3-record (artifact): FAIL — path:out/report.txt la |
| VE-H1-t01-canonical | — | PASS | PASS | ✗ |  | visible-tests:PASS | — |
| VE-H2-t03-canonical | — | PASS | PASS | ✗ |  | visible-tests:PASS | — |
| VE-H3-f5-provable-only | — | PASS | PASS | ✗ |  | c1-args:PASS c2-retry:PASS c3-suite:PASS | — |

## 分类检出率

| 类 | 病态夹具 | 检出 | 检出率 | 明细 |
|---|---|---|---|---|
| ① 迎合实现 | 2 | 2 | 100.0% | VE-F1-special-case(FAIL)，VE-F2-built-not-loadbearing(FAIL) |
| ② 验证错配 | 2 | 2 | 100.0% | VE-F3-edge-green-trunk-broken(FAIL)，VE-F4-discriminative-evidence(FAIL) |
| ③ 沙箱外判据 | 1 | 1 | 100.0% | VE-F5-unverifiable(UNVERIFIABLE) |
| ④ 信息缺失 | 1 | 1 | 100.0% | VE-F6-no-read(FAIL) |

**病态合计**：6/6（100.0%）；**健康对照误杀**：0/3（0.0%）

### ④类分维度（VE-F6）

- 内容检出（栈终局 FAIL）：✓ — 栈基于 supplied 的 L2 判据对错误格式判 FAIL
- grounding 检出（写前 read 依据文件）：✓ — 栈 有 grounding-violation 标记
- 综合检出（G1 口径 FAIL+标记）：✓

## ②类判定依据质量（防"碰巧 FAIL"）

- VE-F3-edge-green-trunk-broken：栈终局 FAIL（检出）；判别性见证（replay 到 buggy 必须 FAIL）✓ — medicine: test-suite: buggy=PASS fixed=PASS → REGRESSION_ONLY
- VE-F4-discriminative-evidence：栈终局 FAIL（检出）；判别性见证（replay 到 buggy 必须 FAIL）✓ — medicine: test-suite: buggy=PASS fixed=PASS → REGRESSION_ONLY

## 门判定

- G1 病态 6/6 检出（③以正确 UNVERIFIABLE 计，④以 FAIL+grounding 标记计）：**YES** — ① 迎合实现 2/2；② 验证错配 2/2；③ 沙箱外判据 1/1；④ 信息缺失 1/1
- G2 健康对照 3/3 不误杀：**YES** — 误杀 0/3
- G3 药方满足 AP-1（全部离线/判定侧实现，fast path 零新增注入、零额外 LLM 往返）：**YES** — 结构性满足：全部药方为 core 纯函数 + runner 侧 spawnSync；离线跑批，零模型、零往返；escalation 后端与 loop 层未触碰（审查确认）

**治疗臂判定：PASS**（FAIL = 任一门失败；G1/G2 任一 FAIL → 该类记"现架构不可治"，如实写进效力报告，不续命）

## 药方对应（仅门触发的类建设）

| 药方 | 类 | 建设状态 | 依据 |
|---|---|---|---|
| M-A | ① 迎合实现 | 未触发 | trunk-path 模板库 + 隐藏代表性输入生成 |
| M-B | ② 验证错配 | 未触发 | 判别性证据规则（replay 到 buggy 必须 FAIL） |
| M-C | ③ 沙箱外判据 | 未触发 | UNVERIFIABLE 三态 |
| M-D | ④ 信息缺失 | 未触发 | grounding 证据检查 |

