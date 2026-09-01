# P2 Escalation Proof Spike — 门判定报告

结果目录：E:\AI\dsh-gungnir\tools\experiments\ve-bench\p2\results\p2-2026-08-31T11-41-06-484Z；总行 1；有效 1；INVALID/HARD_FAIL 0；E1 已派生 0

## G1 成本门（A + H1）
- E0 中位 token: null（n=0）；E2 中位 token: null（n=0）；增幅: n/a（阈值 ≤ +10% → FAIL）
- LLM 往返中位: E0=null vs E2=null；增量 n/a（阈值 = 0 → FAIL）
- 健康任务介入（E2）: 0（阈值 = 0 → PASS）；健康升级: 0（阈值 = 0 → PASS）
- **G1 判定: FAIL**

## G2 检出门（B；E1 派生裁决）
- B 层介入: 0 次（其中 H1 健康误报 0）；假阳性率 0%（阈值 ≤ 1/4 → PASS）
- **G2 判定: PASS**

## G3 升级价值门（消融）
- C 层 wall 中位: E2=nullms vs E3=95871ms；省 n/a（(b) 要求 ≥20% → FAIL）
- C 层 token 中位: E2=null vs E3=20412；省 n/a（(b) 要求 ≥20% → FAIL）
- **G3 判定: FAIL**（(a) 或 (b) 任一成立即过）

## G4 无回归门
- H1 健康成功率（E1 口径）: E0=0/0；E2=0/0（要求 E2 = E0 → PASS）
- H1 假完成放行: E0=0 vs E2=0（要求 E2 ≤ E0 → PASS）
- 超时: 0（要求零新增 → PASS）
- **G4 判定: PASS**

## 总判定（退出线 ADR-0021 §4）
- **G1 FAIL → BPAR 死刑**，回离线资产形态。
- **G3 FAIL → loop 件永久归档**；被动面 + 契约若 G1/G2/G4 过仍可单独成立。
