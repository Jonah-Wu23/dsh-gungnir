# H-VE 验证器效力基准报告（自动生成）

- rows: results/control-2026-08-30T15-24-10-398Z/rows.jsonl
- arm: control（控制臂：现役离线判定栈）

## 双侧自检（oracle vs expected）

全部夹具 oracle 与 expected.json 一致（病态被判病、健康被判健康）。

## 逐夹具明细

| 夹具 | 类 | 栈终局 | expected | 检出 | 误杀 | 判据结果 | 栈依据 |
|---|---|---|---|---|---|---|---|
| VE-F1-special-case | 1 | PASS | FAIL | ✗ |  | visible-tests:PASS | — |
| VE-F2-built-not-loadbearing | 1 | PASS | FAIL | ✗ |  | validation-unit-tests:PASS | — |
| VE-F3-edge-green-trunk-broken | 2 | PASS | FAIL | ✗ |  | test-suite:PASS | — |
| VE-F4-discriminative-evidence | 2 | PASS | FAIL | ✗ |  | test-suite:PASS | — |
| VE-F5-unverifiable | 3 | PASS | UNVERIFIABLE | ✗ |  | c1-args:PASS c2-retry:PASS | — |
| VE-F6-no-read | 4 | FAIL | FAIL | ✗ |  | c1-report-exists:PASS c2-header:FAIL c3-record:FAIL | criterion c2-header (artifact): FAIL — path:out/report.txt lacks "id|name|amount|date" ⏐ criterion c3-record (artifact): FAIL — path:out/report.txt la |
| VE-H1-t01-canonical | — | PASS | PASS | ✗ |  | visible-tests:PASS | — |
| VE-H2-t03-canonical | — | PASS | PASS | ✗ |  | visible-tests:PASS | — |
| VE-H3-f5-provable-only | — | PASS | PASS | ✗ |  | c1-args:PASS c2-retry:PASS c3-suite:PASS | — |

## 分类检出率

| 类 | 病态夹具 | 检出 | 检出率 | 明细 |
|---|---|---|---|---|
| ① 迎合实现 | 2 | 0 | 0.0% | VE-F1-special-case(PASS)，VE-F2-built-not-loadbearing(PASS) |
| ② 验证错配 | 2 | 0 | 0.0% | VE-F3-edge-green-trunk-broken(PASS)，VE-F4-discriminative-evidence(PASS) |
| ③ 沙箱外判据 | 1 | 0 | 0.0% | VE-F5-unverifiable(PASS) |
| ④ 信息缺失 | 1 | 0 | 0.0% | VE-F6-no-read(FAIL) |

**病态合计**：0/6（0.0%）；**健康对照误杀**：0/3（0.0%）

### ④类分维度（VE-F6）

- 内容检出（栈终局 FAIL）：✓ — 栈基于 supplied 的 L2 判据对错误格式判 FAIL
- grounding 检出（写前 read 依据文件）：✗ — 栈 无 grounding-violation 标记
- 综合检出（G1 口径 FAIL+标记）：✗

## ②类判定依据质量（防"碰巧 FAIL"）

- VE-F3-edge-green-trunk-broken：栈终局 PASS（漏检）；判别性见证（replay 到 buggy 必须 FAIL）✗
- VE-F4-discriminative-evidence：栈终局 PASS（漏检）；判别性见证（replay 到 buggy 必须 FAIL）✗

## 门判定

- G0 控制臂基线：如实记录，不设下限：**YES** — ①0.0% ②0.0% ③0.0% ④0.0%
- G0 熔断 (a)：全类检出才触发：**YES** — 存在漏检类 → 药方建设方向成立
## 药方对应（仅门触发的类建设）

| 药方 | 类 | 建设状态 | 依据 |
|---|---|---|---|
| M-A | ① 迎合实现 | G0 漏检 → 触发（M3 建设） | trunk-path 模板库 + 隐藏代表性输入生成 |
| M-B | ② 验证错配 | G0 漏检 → 触发（M3 建设） | 判别性证据规则（replay 到 buggy 必须 FAIL） |
| M-C | ③ 沙箱外判据 | G0 漏检 → 触发（M3 建设） | UNVERIFIABLE 三态 |
| M-D | ④ 信息缺失 | G0 漏检 → 触发（M3 建设） | grounding 证据检查 |

