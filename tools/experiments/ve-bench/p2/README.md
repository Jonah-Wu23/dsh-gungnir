# P2 Escalation Proof Spike（三阶段 P2，ADR-0021）

检验 **BPAR v0**（Baseline-Preserving Adaptive Runtime）：一次性契约 + 被动面 +
恒等 driver + 例外升级能否做到健康任务成本 ≈ 原生（AP-1），且在模型已知会犯病的
任务面上运行期拦截率追平离线法官（E1 ceiling）。

## 目录

| 文件 | 职责 |
|---|---|
| `PRE-REGISTRATION.md` | 预注册冻结（P2-1）：门 G1-G4、触发器 SIG-1..4、规模 44 run、INVALID 处置表、审查门结果 |
| `manifest.mjs` | 跑批清单（A/B/C 三层，44 run 生成） |
| `run-p2.mjs` | 真实模型并发跑批器（--arm E0/E2/E3；契约经插件内部推导路径加载即删；token/roundTrips 采集） |
| `derive-e1.mjs` | E1 派生臂：对 E0/E2/E3 录档离线全量裁决（零模型 run） |
| `report-p2.mjs` | G1-G4 门判定 |
| `selfcheck/run-selfcheck.mjs` | 装置双侧自检（16/16：病态必触发/健康必不触发 × 全触发器 × 全任务） |
| `tasks/` | C 层任务（C1-envwall / C2-redherring + 替补池） |
| `contracts/` | C 层派发契约 |
| `prompts/` | C 层 prompt（无 ENV_NOTE、无解法提示） |
| `results/` | 跑批结果（p2-<ts>/）+ 自检 |

## 臂

- **E0**：原生 DSH（exp-* profile），基线成本 + 自然犯病率。
- **E1**：派生臂（零模型 run），离线供给闭环裁决 = 检出 ceiling / ground truth。
- **E2**：BPAR 全形态（p2-e2/p2-e2-gpt profile：恒等 driver + 被动面 bpar +
  wrapup claim-check + 例外升级 SIG-1..4 → MAF/VERIFY/RECOVER）。
- **E3**：被动面-only（p2-e3/p2-e3-gpt：原生 driver + 被动面 + MAF，无升级接线）——消融臂。

## 关键纪律（泄题 + 归因）

- 工作区与全部临时文件中性命名（`p2-ws-<rand>`），模型可见面不得出现臂名/任务代号/
  红鲱鱼字样（审查门 HIGH 项，已修并复评 PASS）。
- 契约经插件内部推导路径加载即删（%TEMP%/p2-supply-<ws目录名>.json，模型不可读）；MAF 不回显变换后命令；探针隐藏输入经 stdin 注入磁盘零落盘。
- 完成声明行（create_goal + update_goal complete）是 wrapup seam 触发前提（预注册 §8.1）。
- 铁律 10：INVALID 行保留落档、不进分母；装置缺陷修后重烧再判。

## 用法

```bash
# 自检（跑批前置，16/16 必须全过）
node selfcheck/run-selfcheck.mjs
# 正式批（44 run；审查门双 PASS 后）
node run-p2.mjs --concurrency 2
# 断点续跑
node run-p2.mjs --resume results/p2-<ts> --concurrency 2
# E1 派生裁决 + 门判定
node derive-e1.mjs results/p2-<ts>
node report-p2.mjs results/p2-<ts>
```
