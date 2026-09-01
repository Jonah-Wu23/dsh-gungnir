# tools/ve-supply — 派发契约供给闭环工具

把验过的法官（治疗臂判定栈）从夹具考场带进真实工作现场：派发者写契约，harness 出钓鱼题、离线裁决交付物（ADR-0020，执行基准《派发契约与钓鱼题供给线计划》B2）。

## Contract（做什么 / 不做什么）

**做什么**：给定 派发契约 JSON + 交付工作区 +（可选）DSH session log，输出 裁决 + 证据链 + 供给覆盖报告。流程 = `contractToSupplied` 投影（core 纯函数）→ git 快照提取 buggy 基底（M-B）→ session log 提取 tool-log（S1/M-D）→ 治疗臂判定（L1/L2 现役 verifier + S1 通用不变量 + M-A~M-D 药方）。

```text
派发契约 JSON ──→ contractToSupplied ──→ supplied 四块 ──→ adjudicate ──→ verdict + reasons
     │                                        │                 │             + coverage
     ├── baselineRef ──→ snapshot.mjs (git archive) ──→ buggy 基底（M-B replay）
     └── session log ──→ toollog.mjs (zstd 解码) ──→ tool-log（S1 / M-D grounding）
```

- `snapshot.mjs`：`baselineRef`（git commit）→ `git archive` 提取派发点工作区到系统临时目录（M-B buggy 基底）。
- `toollog.mjs`：DSH session log（`session.jsonl.zstd`，多帧 zstd 容器）→ ToolEventView JSONL（tool/call + tool/result；路径归一为工作区相对）。
- `run-supply.mjs`：主入口（见其头部 usage）。

**不做什么**：不做自动派发 runtime、不碰 loop 层与运行期介入（wrapup 钩子 + MAF 注入维持 ADR-0018 §5 冻结）；不 import `tools/experiments/` 冻结物（medicines/adjudicate 为提升复制并如实标注来源与差异）；不改 ve-bench 已入库结果；钓鱼题不由运行时 AI 即兴生成（probe 由 core 模板库纯函数构造，同 seed 同题）。

## 药方执行面

`medicines.mjs` / `adjudicate.mjs` 从 `tools/experiments/ve-bench/stack/` 提升复制（冻结资产未改动；差异点：M-B 基底为 git 快照、M-D tool-log 显式传入、无控制臂形态）。决策逻辑全部在 `@gungnir/core` 纯函数（`ve.ts` 药方、`contract.ts` 投影、`passive.ts` S1）。验证命令一律 runner 侧构造 + spawnSync；probe 写文件再 node 跑（ADR-0018 §2 引号教训）；probe 注入物跑完即删（工作区卫生）。

## 演示

`demo/task/` = 演示任务基底（`src/pipeline.js` 含派发点 bug；`test/pipeline.test.js` 是派发验收探针）。真实演示记录（真实 profile `exp-standard` 真跑 + 手填契约 + 双侧裁决）在 `results/`，摘要见 `docs/context/state.md`。

## Known Limitations

- `replay.evidence` v0 只取契约声明的 provable L1 command 判据（最诚实）；从 session log 提取 agent 实际跑过的命令列为后续增强，未实现。
- M-A 模板库覆盖面 = 现役 2 模板（`pricing-round-once` / `pipeline-validation`）；新任务形态需扩模板库（构造者偏差方向由双侧自检保证）。
- M-D grounding 只判 read→write 时序（Let It Go：不检测"读了但没用"）；agent 用 pwsh 内联写文件时无 `write` 工具事件 → 检查静默不触发（诚实 no-op，不误报）。
- session log 定位依赖 cwd 编码目录反查（`~/.dsh/sessions/`）；直接传 session log 路径可绕过。torn-tail（非预期中断）由 DSH 自动修复，解析前可先 `dsh` 会话读取。
- 本工具是离线/判定侧资产（四阶段 P0）：真实环境覆盖面（多任务形态、M-B 对非 node 工具链、跨平台路径归一）未在更大样本上验证。
