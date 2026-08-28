# Stage-2 四组对照实验报告（自动生成）

rows: tools/experiments/stage2/results/stage2-2026-08-28T22-42-03-997Z/rows.jsonl

| 组 | success | wall 中位 | round-trips 中位 | tool calls 中位 | tokens in/out 中位（下界估计） | wasted steps | violations |
|---|---|---|---|---|---|---|---|
| standard | 6/6 | 14281ms | 4.5 | 5.5 | 6113/1003.5 | 0 | 0 |
| ptc | 6/6 | 15068.5ms | 4 | 3 | 5884.5/1032.5 | 0 | 0 |
| workflow | 6/6 | 16479ms | 4 | 5.5 | 6121/998 | 0 | 0 |
| gungnir | 6/6 | 102449ms | 13.5 | 14.5 | 9449.5/12220 | 1 | 0 |

## 冻结门判定（Gungnir vs Code-PTC）

- task success 不下降：YES（6/6 vs 6/6）
- input tokens ↓≥20%：-60.6%（阈值 20%）→ 未达标
- LLM round-trips ↓≥25%：-237.5%（阈值 25%）→ 未达标
- latency ↓≥15%：-579.9%（阈值 15%）→ 未达标
- 重复无效步骤 ↓≥30%：n/a（阈值 30%）→ 未达标

达标项数：0/4；**判定：FAIL**

## 逐任务明细

| 组 | 任务 | success | wall(ms) | trips | tools | tokensIn(估) | wasted |
|---|---|---|---|---|---|---|---|
| standard | t1-multi-file | Y | 14113 | 3 | 6 | 6145 | 0 |
| ptc | t1-multi-file | Y | 10109 | 3 | 2 | 5587 | 0 |
| workflow | t1-multi-file | Y | 14268 | 3 | 6 | 6155 | 0 |
| gungnir | t1-multi-file | Y | 91098 | 10 | 11 | 7523 | 1 |
| standard | t2-bugfix-tests | Y | 40525 | 8 | 8 | 6868 | 1 |
| ptc | t2-bugfix-tests | Y | 42478 | 9 | 8 | 7572 | 1 |
| workflow | t2-bugfix-tests | Y | 35030 | 8 | 8 | 6803 | 0 |
| gungnir | t2-bugfix-tests | Y | 297678 | 29 | 36 | 57216 | 1 |
| standard | t3-transform | Y | 12621 | 4 | 3 | 5851 | 0 |
| ptc | t3-transform | Y | 19010 | 4 | 3 | 6173 | 0 |
| workflow | t3-transform | Y | 13476 | 4 | 4 | 5931 | 0 |
| gungnir | t3-transform | Y | 113800 | 17 | 18 | 10027 | 1 |
| standard | t4-refactor | Y | 29265 | 6 | 10 | 6636 | 0 |
| ptc | t4-refactor | Y | 22888 | 5 | 4 | 6028 | 0 |
| workflow | t4-refactor | Y | 18690 | 5 | 9 | 6608 | 0 |
| gungnir | t4-refactor | Y | 138441 | 18 | 26 | 12115 | 3 |
| standard | t5-workspace-qa | Y | 14449 | 5 | 5 | 6081 | 0 |
| ptc | t5-workspace-qa | Y | 11127 | 4 | 3 | 5741 | 0 |
| workflow | t5-workspace-qa | Y | 23124 | 4 | 5 | 6087 | 0 |
| gungnir | t5-workspace-qa | Y | 51240 | 10 | 11 | 8872 | 1 |
| standard | t6-knowledge-write | Y | 10861 | 3 | 2 | 5673 | 0 |
| ptc | t6-knowledge-write | Y | 10657 | 3 | 2 | 5628 | 0 |
| workflow | t6-knowledge-write | Y | 10317 | 3 | 2 | 5702 | 0 |
| gungnir | t6-knowledge-write | Y | 39640 | 8 | 9 | 7620 | 1 |

