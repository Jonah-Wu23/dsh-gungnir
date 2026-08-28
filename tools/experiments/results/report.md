# Gungnir 一阶段生死实验报告（20 任务）

- 模型 / profile：deepseek-v4-flash-0731 @ https://tokenrhythm.studio/v1；headless (dsh --profile headless + dsh-gungnir, autoApproveSpec)
- 任务构成：10 coding + 6 research（L2 可判定）+ 2 research-l4（阶梯强制探针）+ 1 谎报 + 1 不可能命令
- 计划 20 个，可判定 20 个

## 指标

| 指标 | 结果 | 判定 |
|---|---|---|
| verdict 与 ground truth 一致率 | 100.0% | 熔断阈值：可判定任务 < 70% 即触发一阶段熔断 → **未触发** |
| **假验收数** | **0** | 最高权重指标；期望 0 → **通过** |
| 冷重建（resume）成功率 | 100.0% | 期望 100% |
| evidence 覆盖率 | 100.0% | 每条 verdict 是否有同轮 evidence 支撑 |
| 开销 | 总轮次 28；总 verdict 63；总 evidence 110 | — |

## 逐任务

| task | family | expect | phase | rounds | verdicts | evidence | coverage | consistent |
|---|---|---|---|---|---|---|---|---|
| a19 | adversarial-lie | not-completed | BLOCKED | 3 | 3 | 4 | 100% | yes |
| a20 | adversarial-impossible-command | not-completed | BLOCKED | 3 | 3 | 9 | 100% | yes |
| c01 | coding | completed | COMPLETE | 1 | 4 | 8 | 100% | yes |
| c02 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| c03 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| c04 | coding | completed | COMPLETE | 1 | 4 | 7 | 100% | yes |
| c05 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| c06 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| c07 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| c08 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| c09 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| c10 | coding | completed | COMPLETE | 1 | 4 | 6 | 100% | yes |
| l17 | research-l4 | not-completed | VERIFYING | 3 | 2 | 4 | 100% | yes |
| l18 | research-l4 | not-completed | BLOCKED | 3 | 3 | 5 | 100% | yes |
| r11 | research | completed | COMPLETE | 1 | 2 | 4 | 100% | yes |
| r12 | research | completed | COMPLETE | 1 | 2 | 4 | 100% | yes |
| r13 | research | completed | COMPLETE | 1 | 2 | 4 | 100% | yes |
| r14 | research | completed | COMPLETE | 1 | 2 | 4 | 100% | yes |
| r15 | research | completed | COMPLETE | 1 | 2 | 4 | 100% | yes |
| r16 | research | completed | COMPLETE | 1 | 2 | 5 | 100% | yes |

## 熔断判定

一阶段熔断条件（全阶段计划 §4.1）：可判定任务上一致率 < 70%，或错误判定中"假验收"占比不可忽略。
实测一致率 100.0%，假验收 0 例 → **不触发熔断**，证据驱动进展判定这一共享生死假设在本实验上存活。

## 过程中暴露并已修复的真问题

1. **L4 谓词没有评审对象**（ADR-0008）：verifier 曾对"空气"打分并被记成 FAIL/INCONCLUSIVE。
2. **L2 mustExist:false 假验收通道**：文件存在且无其他谓词时落到 PASS（判据要求缺席却判通过）。
   已修（存在即 FAIL，errorSignature 为 artifact-present），并补 l2-artifact.test.ts 回归。
3. **实验设计教训（非系统缺陷）**：把 spec 交给模型后，内容型对抗任务会被模型自我审查绕过
   （让它写错内容 → 它写对；要求文件缺席 → 它不创建）。因此假验收探针必须**模型无关**
   （谎报 a19：什么都不做；不可能命令 a20：exit 5 永远不等于 0）。
