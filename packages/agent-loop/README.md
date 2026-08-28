# dsh-gungnir-loop

**Gungnir Adaptive Loop Runtime** — a drop-in replacement driver for the DSH default agent loop. *Lock the goal. Adapt the loop. Prove the hit.*

Adaptive Loop Runtime（`@gungnir/agent-loop`，发布名候选 `dsh-gungnir-loop`）：经 DSH 官方组合接缝一次性替换默认 agent-loop 的树外 driver（ADR-0012/0014）。session 生命周期内单实例；运行期由确定性 router 在 FAST / EXECUTE / VERIFY 三种 Loop Strategy 之间切换（ADR-0015）。

## Contract

- **做什么**：
  - 完整承担默认 driver 的九项职责（agent 生命周期 / turn-step 边界 / pre-step 管线 / 请求构造 / LLM 流 / 工具调度 / 取消 / resume-fork / 系统提示面，清单见 `docs/context/dsh-interface.md` §16.2），session log 事件语义与默认 driver 一致（B3 红线，`tools/loop-verify/compare-events.mjs` 对照）。
  - 每步经确定性 router（`@gungnir/core` routeLoopMode）选择 Loop Strategy；切换与快照经本地事件 `gungnir-loop/transition|state` 交由 Prove 层落账（`gungnir/loop-transition|loop-state`）。
  - hysteresis：单 turn 切换预算 4（`MAX_MODE_TRANSITIONS_PER_TURN`），耗尽即保持。
  - 服务键保持 `ctx.agentLoop`（`AgentFactory`），headless / ACP / subagent 等消费方透明。
- **不做什么**：
  - 不修改 DSH 源码、不 fork；不重写 history；不做实例级热插拔（open turn / open step / pending tool call / active AbortSignal 下不替换 driver）。
  - 不做 LLM router、不做文本语义嗅探——router 只消费 fold 状态派生的结构化事实。
  - 不持有持久化：loop 事件的 durable 载体归 Prove 层（dsh-gungnir 插件 + ctx.storage ledger）。
  - 不实现完整 hysteresis 五件套（dwell / cooldown / evidence threshold / circuit breaker 归三阶段）；不实现模型/成本轴（cheap model、reasoning budget 归三阶段 model 轴）。

## Composition

profile bundles 清单中替换默认行（`cordis.patch.yml` 两步法）：

1. `agent-loop` 行 `disabled: true`（patch 按 id 原位修改；`name` 是守卫不能改写包名）；
2. `insert` 本包行（服务键 `agentLoop`）。

配合 `dsh-gungnir`（Prove 层）时：插件提供可选服务 `gungnirAdaptive`（router 输入 + 账本现值 Loop Mode），driver 据此选模式并经本地事件落账；插件缺席时 driver 退化为原生路径（FAST，零注入）。

## Events

本地（非 durable）：`gungnir-loop/transition`（from/to/turn/step/rule）、`gungnir-loop/state`（mode/turn/step 快照）。
Durable（由 dsh-gungnir 落账）：`gungnir/loop-transition`、`gungnir/loop-state`（schema 与 fold 见 `@gungnir/core`）。

## Failure discipline

- 账本 append 失败（含 fold 拒绝）fail loud：Prove 层日志报错、账本停在最后一致事件；driver 不因落账失败中断 turn。
- hysteresis 预算耗尽不是错误：保持当前模式并如实落快照。

## Known Limitations

- v0 的 FAST 模式不降模型档/不裁工具面（质量护栏）；成本轴归三阶段。
- 未实现 driver 侧的 settings 段（默认 driver 的 `agent-loop` settings namespace 未镜像）；配置经 bundle 行 config 提供。
- 三模式收益未经四组对照实验验证前，本包默认仅在实验/开发 profile 启用（`gungnir-loop` profile）。
- 与宿主必须解析到同一份 `@deepseek-ai/*` 模块（`Symbol` 符号线单实例纪律，ADR-0014）。
