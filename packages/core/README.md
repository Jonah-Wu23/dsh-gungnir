# @gungnir/core

Gungnir 的纯域函数包：GoalSpec / ledger 事件 / verdict 的 zod schema、fold（strict replay）、Reconciler 决策表、Verifier 契约。**零 DSH 依赖**——fold/replay 与决策全部是可脱离 harness 全量单测的纯函数，这是"从 ledger 重建可信"的前提。

## Contract

**做什么**

- **Schema v1（M0 冻结）**：`GoalSpec`（objective / successCriteria / constraints / nonGoals / assumptions / budget；criterion 携带 `predicate` 与 `verifierLevel`，二者一致性在 parse 时强制）；九类事件 `gungnir/spec | plan-projection | commit | evidence | claim | verdict | status | loop-state | loop-transition`；envelope `{v:1, ts}` 由单一时间权威。
- **fold（strict replay）**：`foldEvents(raw[]) → GungnirState` 纯函数重放。畸形 schema、断序 round、非法 phase 转换、快照与派生值不一致、verifier 与 criterion 声明不匹配、FAIL 无签名、evidenceId 重复……任何违规立即抛 `FoldError` 并停在首个坏事件（`eventIndex`/`code` 可定位）。绝不静默跳过或猜测修复。
- **Reconciler**：`reconcile(state, roundVerdicts) → Decision` 决策表——ADVANCE / REPLAN / RETRY / BLOCKED / NEEDS_HUMAN / REVALIDATE / COMPLETE。熔断三件套（budget.maxRounds、budget.maxVerifierRuns、roundsNoImprovement ≥ 3、consecutiveInconclusive ≥ 3）任一触发即禁止继续 commit。阶梯强制：L4 PASS 在生效判定中降级 PARTIAL（纯语义永远不足以支撑最终 PASS）；COMPLETE 要求存在 L1/L2 PASS 佐证（`deterministicPassSeen`）。
- **Verifier 契约**：`Verifier { kind, level, verify(criterion, ctx) }` + `VerifyContext`（runCommand / readFile / completeRubric / now 由宿主注入）。契约在此，实现在 dsh-gungnir。

**不做什么**

- 不 import 任何 DSH/cordis 模块；不做 IO（node:crypto 仅用于确定性 digest）。
- 不决定"如何执行"——投影与 action 的作者是模型，裁决只依据事件流。
- 不实现 verifier 本体、不管理 native goal、不渲染任何 UI 文本。

## Known Limitations

- `gungnir/loop-state` / `gungnir/loop-transition` 仅为三阶段占位命名空间（ADR-0005）：schema 可 parse，fold 遇到即抛 `reserved`。
- REVALIDATING 中"全部满足但无 L1/L2 佐证"的 COMPLETE 拒绝分支是防御性守卫：在现行 effectiveOutcome 规则下结构性不可达（L4 PASS 必然降级），保留作 defense-in-depth。
- `roundsNoImprovement` 只在离开 VERIFYING（轮末）时结算；REVALIDATING 的进出不重复计数。
- 一阶段 L3 external-state 与 L5 human 无 verifier 实现：human 谓词 criterion 只能经 NEEDS_HUMAN 出口。
