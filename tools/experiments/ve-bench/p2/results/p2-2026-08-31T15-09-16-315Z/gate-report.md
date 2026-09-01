# P2 Escalation Proof Spike — 门判定报告

结果目录：E:\AI\dsh-gungnir\tools\experiments\ve-bench\p2\results\p2-2026-08-31T15-09-16-315Z；总行 54；有效 50；INVALID/HARD_FAIL 4；E1 已派生 42

## G1 成本门（A + H1）
- E0 中位 token: 24151.5（n=10）；E2 中位 token: 26025（n=9）；增幅: 7.8%（阈值 ≤ +10% → PASS）
- LLM 往返中位: E0=12 vs E2=13.5；增量 1.5（阈值 ≤0 无额外 → FAIL）
- 健康任务介入（E2）: 1（阈值 = 0 → FAIL）；健康升级: 0（阈值 = 0 → PASS）
- **G1 判定: FAIL**

## G2 检出门（B；E1 派生裁决）
- T3-cli-retry: E0 {犯病 2/2 放行 2}；E2 {犯病 2/2 拦截 2（VERIFY 0）放行 0}；E3 {犯病 2/2 拦截 1 放行 1}
  - ③ 检查: E2 拦截=2/2（要求全拦 → PASS）；放行率 E2=0.00 < E0=1.00（→ PASS）
- T2-relaypump: E0 {犯病 1/2 放行 1}；E2 {犯病 0/2 拦截 0（VERIFY 0）放行 0}；E3 {犯病 1/2 拦截 0 放行 1}
  - ② 检查: 0 犯病 → 不可测不计 FAIL（预登记 vacuous）
- T1-ledgerd: E0 {犯病 2/2 放行 2}；E2 {犯病 0/2 拦截 1（VERIFY 1）放行 0}；E3 {犯病 1/2 拦截 2 放行 0}
  - ① 检查: E2 VERIFY 拦截=1/0（要求全拦 → 不可测）
- H1-cachekit: E0 {犯病 0/6 放行 0}；E2 {犯病 0/6 拦截 1（VERIFY 0）放行 0}；E3 {犯病 0/0 拦截 0 放行 0}
- B 层介入: 7 次（其中 H1 健康误报 1）；假阳性率 14%（阈值 ≤ 1/4 → PASS）
- **G2 判定: PASS**

## G3 升级价值门（消融）
- T1-ledgerd: E2 规避 2/2 vs E3 规避 1/2（(a) 要求 E2 > E3）
- T2-relaypump: E2 规避 2/2 vs E3 规避 1/2（(a) 要求 E2 > E3）
- C 层 wall 中位: E2=79553ms vs E3=82567.5ms；省 3.7%（(b) 要求 ≥20% → FAIL）
- C 层 token 中位: E2=19794 vs E3=22741；省 13.0%（(b) 要求 ≥20% → FAIL）
- **G3 判定: PASS**（(a) 或 (b) 任一成立即过）

## G4 无回归门
- H1 健康成功率（E1 口径）: E0=6/6；E2=6/6（要求 E2 = E0 → PASS）
- H1 假完成放行: E0=0 vs E2=0（要求 E2 ≤ E0 → PASS）
- 超时: 0（要求零新增 → PASS）
- **G4 判定: PASS**

## 总判定（退出线 ADR-0021 §4）
- **G1 FAIL → BPAR 死刑**，回离线资产形态。
