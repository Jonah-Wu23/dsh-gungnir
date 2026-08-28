好。既然你选的是 **B：通用 Goal Runtime**，那 UltraGoal 的战略定位就完全不同了。

我按你上传的 Skill 继续完成阶段一到阶段五：先做第一性原理解构，再做历史/跨领域映射，再让三个互相冲突的视角对抗，最后给出两条底层逻辑不同的路线。这个顺序正对应 Skill 对“事实/假设/目标/约束”“跨域同构”“三视角证伪”“双轨极化”的要求。

# 一、先给结论：UltraGoal 不应该是“超级任务规划器”

我认为你最初的概念里，**80% 是对的，但核心抽象还差半层。**

你现在描述的是：

```text
Goal
↓
苏格拉底澄清
↓
生成完整步骤 JSON
↓
Step 1
↓
执行
↓
actual_result
↓
和 expected_result 比较
↓
Step 2
↓
...
↓
Regression
↓
Complete
```

这个东西如果照原样做，最后很容易变成：

> **一个带持久化、自动续跑和验收机制的高级 Todo List。**

而真正有潜力成为基础设施的 UltraGoal，应该把抽象改成：

```text
Human Intent
        ↓
    GoalSpec
    目标契约
        │
        │ desired state
        ▼
┌──────────────────────┐
│   UltraGoal Reconciler│
│                      │
│ Observe current state│
│ Validate assumptions │
│ Plan next action     │
│ Execute              │
│ Collect evidence     │
│ Verify               │
│ Replan / Advance     │
└──────────┬───────────┘
           │
           ▼
      GoalStatus
           │
   spec ≈ status ?
      /          \
    No            Yes
    │              │
继续 reconcile   Goal-level
                revalidation
                    ↓
                COMPLETE
```

换句话说：

> **UltraGoal 应该是 Goal Reconciliation Runtime，而不是 Goal Planner。**

这两个词看起来只差一点，实际上是产品范式上的区别。

------

# 二、阶段一：第一性原理破壁

你的 Skill 要求先把术语剥掉，区分事实、假设、本质目标与硬约束。

把 DSH、Agent、JSON、Skill 全部拿掉之后，UltraGoal 实际解决的问题是：

> **一个人告诉另一个并不完全可靠、记忆有限、身处变化环境中的执行者：“我要 X。”如何保证这个执行者经过很多行动以后，最终真的把现实世界推进到 X，而不是仅仅认为自己完成了 X？**

这才是 UltraGoal 的本体。

### 已确认事实

第一，**通用 Goal 是开放世界问题**。

“修复这个 bug”和“调查下一代 AI 架构”和“帮我申请香港硕士”和“设计商业模式”，它们不存在统一的确定性完成函数。

第二，**计划执行期间世界会变化**。

网页更新、文件被修改、代码产生新 bug、API 返回改变、用户改变主意、某一步发现之前的假设错误。

第三，**LLM 自己报告 `actual_result` 不能作为可信事实来源。**

模型说：

```json
{
  "step": "run_tests",
  "actual_result": "all tests passed"
}
```

只能证明：

> 模型声称测试通过了。

它不能证明测试真的通过。

而 DSH 本身已经有 `tools/result`、durable `tool/result` / session events，以及可以监听 `session/event` 的插件机制。因此 UltraGoal 完全可以尽可能从 Harness 自己观察到的工具执行事实中构造证据，而不是让模型自己给自己打分。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md?utm_source=chatgpt.com))

第四，**DSH 已经替你解决了一大块基础问题。**

截至现在，DSH 原生已有：

`ctx.goals` 的持久 Goal 状态、goal revision、pause/resume/complete/block/clear；`goal-round-driver` 负责同 session 自动续轮；`tool-goal` 暴露模型控制；另外还已经存在 Dynamic Workflow 能力。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/README.md?utm_source=chatgpt.com))

所以：

> **UltraGoal 千万不要重新发明 `/goal + loop + workflow`。**

那不是你的创新点。

### 你当前方案中最危险的四个隐含假设

| 隐含假设                                | 实际问题                              |
| --------------------------------------- | ------------------------------------- |
| Goal 一开始就能完整分解                 | 很多信息只有执行后才出现              |
| `expected_result` 可以提前写死          | 开放世界通常只能定义验收谓词/证据标准 |
| 模型可以判断自己有没有完成              | 存在明显的 self-verification 问题     |
| Step N 成功意味着 Step N+1 的前提仍成立 | 环境可能已经漂移                      |

所以你当前：

```text
expected_result == actual_result
```

这条核心逻辑必须废掉。

应该变成：

```text
Evidence
   ↓
Verifier
   ↓
PASS
FAIL
PARTIAL
INCONCLUSIVE
STALE
NEEDS_HUMAN
```

这会成为 UltraGoal 最重要的技术资产。

------

# 三、真正的核心矛盾

UltraGoal 有三个无法绕开的结构性矛盾。

### 矛盾 1：可预测性 vs 开放世界

越早把 Goal 全部拆成几十个固定 Step，可预测性越强。

但任务越开放，后面的 Step 越容易变成过期计划。

所以：

> **长计划是一种预测，不应该是一种事实。**

### 矛盾 2：自动化 vs 用户真实意图

模型很容易优化 proxy。

用户说：

> “帮我做一个高质量竞品分析。”

模型可能优化：

> 页数、竞品数量、表格数量。

而用户真正想要的是：

> 帮助我做决策。

因此 UltraGoal 必须持久化的不是一句 `objective`，而是一份 **Goal Contract**。

至少需要区分：

| 类型             | 例子                           |
| ---------------- | ------------------------------ |
| Objective        | 我要决定 UltraGoal 应该怎么做  |
| Success Criteria | 得到明确架构选择和可验证实验   |
| Constraints      | DSH 插件，不改核心             |
| Non-goals        | 不重新开发 Workflow Engine     |
| Assumptions      | DSH goal API 可持续使用        |
| User preferences | 自动执行优先，但高风险操作询问 |
| Invariants       | 不破坏已有功能                 |

### 矛盾 3：灵活性 vs 可审计性

如果每轮模型都可以自由改变计划：

> 极其灵活，但可能无限漂移。

如果 Harness 强制执行第一轮生成的计划：

> 极其稳定，但很可能稳定地执行错误计划。

这个矛盾决定了 UltraGoal 必须引入：

> **Plan Version + Invalidation + Replanning。**

------

# 四、阶段二：跨领域推演

你的 Skill 要求寻找历史案例和至少三个距离很远的领域，再抽取底层机制。

我找到的几个同构体非常有意思。

## 历史同构：Apollo

Apollo 并不是简单地给宇航员一本：

> Step 1 → Step 2 → Step 3

然后一路照做。

NASA 将任务按阶段拆解为 checklist；操作程序本身受到配置控制，允许正式记录 deviation；Operational Checkout Procedure 还包含验证和 inspection buy-off。任务控制团队也会通过训练反复验证 procedure 和 mission rules。([NASA技术报告服务器](https://ntrs.nasa.gov/api/citations/19720005243/downloads/19720005243.pdf?attachment=true&utm_source=chatgpt.com))

它给 UltraGoal 的启示是：

> **Procedure、Verification、Deviation 必须是一等公民。**

执行者不能偷偷修改计划。

如果现实与计划不一致：

```text
不是：
“哦，那我换个办法继续。”

而是：
Plan v3
↓
发现 deviation
↓
invalidate Step 7+
↓
生成 Plan v4
↓
留下为什么修改的记录
```

------

# 五、同构领域一：Kubernetes

这是我认为与 UltraGoal **最像**的系统。

Kubernetes 的核心思想不是：

> 给机器一串创建 Pod 的步骤。

而是：

```text
spec = 我想要什么
status = 现在实际上是什么
controller = 不断缩小两者差距
```

Controller 会持续观察实际状态，再做动作，把 current state 推向 desired state；系统也并不假设一次操作后就永久完成。([Kubernetes](https://kubernetes.io/docs/concepts/architecture/controller/?utm_source=chatgpt.com))

这几乎可以直接映射：

```text
Kubernetes           UltraGoal

spec                  GoalSpec
status                GoalStatus
controller            Goal Reconciler
resource observation  Evidence
reconcile()            UltraGoal Round
condition              Acceptance Criterion
```

因此 UltraGoal 的基本单位不应该是：

> Task。

而应该是：

> **Desired State / Observed State Gap。**

这是一个非常大的抽象升级。

------

# 六、同构领域二：Temporal Durable Execution

第二个关键来源是 Temporal。

Temporal 的核心并不是“不会失败”。

而是：

> 失败之后，之前已经确认完成的工作不会因为进程重启而凭空丢失，执行历史能够恢复 Workflow 的逻辑状态。([Temporal](https://temporal.io/?utm_source=chatgpt.com))

对应 UltraGoal：

```text
模型崩了
上下文压缩了
DSH 重启了
换模型了
换 Agent 了

≠

任务重新开始
```

UltraGoal 真正应该持久化的是：

```text
Goal
Plan revisions
Step attempts
Tool evidence
Verification decisions
Assumption changes
User decisions
External waits
Compensations
```

所以 Resume 的正确实现不是：

```json
{
  "current_step": 7
}
```

而是：

> **从 durable execution ledger 重建当前世界模型。**

因为仅仅知道“Step 7”远远不够。

------

# 七、同构领域三：形式化验证

Dafny 之类的系统有非常清晰的：

```text
requires
ensures
decreases
```

也就是：

```text
precondition
postcondition
termination metric
```

Dafny 会验证调用点是否满足前置条件，并检查执行结果是否满足 postcondition。([Dafny](https://dafny.org/dafny/QuickReference?utm_source=chatgpt.com))

这给 UltraGoal 一个非常漂亮的 Step Contract：

```text
StepContract

requires
action
ensures
evidence
invalidation_conditions
rollback
```

但这里也有一个巨大警告：

**自然语言 Goal 不是形式化程序。**

所以 UltraGoal 不能假装所有 `ensures` 都能机器证明。

必须承认验证强度存在层级。

------

# 八、同构领域四：Model Predictive Control

MPC 给了我认为最重要的另一个答案。

MPC 会预测未来很多步。

但它**只执行第一步**。

执行后重新观察现实，再重新优化整个后续控制序列。([MathWorks](https://www.mathworks.com/help/mpc/gs/what-is-mpc.html?utm_source=chatgpt.com))

这几乎直接否定了 UltraGoal 最初的：

> 生成完整 JSON → 从头按顺序执行到底。

更合理的是：

```text
Plan:
S1 S2 S3 S4 S5 S6 S7

只 commit S1

执行 S1

Observe

重新规划：

S2'
S3'
S4'
S5'

只 commit S2'
```

于是计划变成：

> **Rolling Horizon Plan。**

------

# 九、从四个领域提炼出的三个底层机制

这就是 Skill 要求的“跨域机制迁移”。

| 机制                             | UltraGoal 对应设计                          |
| -------------------------------- | ------------------------------------------- |
| Declarative reconciliation       | GoalSpec / GoalStatus，而不是固定 Task List |
| Durable proof-carrying execution | 每个 Step 持久化执行事实和 Evidence         |
| Receding-horizon planning        | 规划未来，但只承诺最近一步，随后重新规划    |

这三个机制组合起来，已经形成一个非常不同于现有 Agent Planner 的东西。

------

# 十、阶段三：三视角对抗

按照 Skill 的要求，现在让三个完全不同的认知框架独立推演并给出证伪条件。

## 视角 A：形式化方法 / 控制论

它会重新定义 UltraGoal：

> 一个在约束条件下，使状态不断逼近目标集合的控制系统。

它最推荐：

**Goal Contract + Step Contract + Verifier + progress function。**

它最害怕的不是模型失败，而是：

> **假验收。**

比如：

```text
目标：
写一份高质量战略分析

Verifier：
文章 > 5000 字

PASS
```

形式上验证成功，目标实际上完全可能失败。

所以这个视角要求：

> 所有可形式化部分尽量形式化，不可形式化部分明确标为不可形式化。

它的证伪条件是：

如果实际 UltraGoal 使用中，大多数 Goal 连稳定的 success criteria 都无法通过有限澄清建立，那么 Contract-first 路线价值会显著下降。

------

## 视角 B：分布式系统 / Workflow

它重新定义 UltraGoal：

> 一个运行时间可能长达小时、天、甚至数周，并跨越进程、模型、工具和外部世界的 durable workflow。

它最关注：

```text
crash
retry
duplicate side effect
timeout
stale state
resume
race
external wait
```

它会极力反对：

```text
Model:
“Step 做完了。”

Harness:
“好的。”
```

它要求：

> **模型报告的是 Claim，工具结果才可能成为 Evidence。**

DSH 已经暴露 `tools/result`、session events 和 `agent/pre-step` 等扩展点，所以这条路线在现有 Harness 上是现实可行的，而不是要求你重写 Agent Loop。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md?utm_source=chatgpt.com))

它的证伪标准是：

如果绝大多数 UltraGoal 都只持续 1～2 个模型回合、没有外部 side effect，也没有 restart/resume，那么 durable runtime 的工程复杂度就不值得。

------

## 视角 C：人因 / 机制设计

它会说前两个视角都搞错了重点。

真正危险的是：

> **机器非常可靠地完成了一个用户其实并不想要的目标。**

因此它认为最重要的数据不是：

```text
steps[]
```

而是：

```text
intent
success criteria
constraints
non-goals
trade-offs
ambiguities
user-owned decisions
```

它会把“苏格拉底询问”设计成：

> **减少决策相关不确定性。**

而不是：

> 每次 Goal 都先问用户十个问题。

如果一个不确定点不会改变：

```text
下一步
Verifier
风险
成本
```

那就不值得打断用户。

它的证伪标准是：

如果长期真实数据证明低介入自动规划的最终用户满意度与频繁 intent clarification 相同，那么可以大幅减少这层机制。

------

# 十一、三方真正达成的共识

三种视角最后会共同接受四件事情。

**计划不是事实，而是假设。**

**模型输出不是证据，而是 Claim。**

**Step 完成不等于 Goal 进度成立。**

**恢复执行不能只知道 current_step，而必须恢复 Goal 的整个可验证状态。**

真正的分歧只有一个：

> **到底应不应该在 Goal 开始时生成完整、具有执行权威性的 Step Graph？**

这正好把 UltraGoal 撕裂成两条真正不同的路线。

------

# 十二、方案 A：UltraGoal Contract VM

这条路线与你最初的想法最近。

### 1. 本质逻辑

把自然语言 Goal 编译成一份完整的 **Goal Program**。

不是普通 checklist，而是一张 versioned execution graph：

```text
GoalContract
   ↓
Plan v1
 ├── S1
 ├── S2
 ├── S3
 └── S4

每一个 Step：
requires
action
ensures
verifier
evidence_policy
rollback
retry
invalidation
```

Harness 变成执行这个 Goal Program 的虚拟机。

### 2. 落地路径

Skill 负责 **Goal Compiler**。

模型通过苏格拉底澄清后调用：

```text
submit_goal_contract()
```

随后 UltraGoal Runtime 管理：

```text
READY
EXECUTING
VERIFYING
PASSED
FAILED
BLOCKED
INVALIDATED
```

模型必须通过：

```text
report_step_claim()
```

报告执行结论，但 Runtime 自己从工具和 session history 捕获 evidence。

`agent/pre-step` 可以负责把当前 Step Contract 注入下一次模型请求；DSH 原生允许 pre-step 重写进入模型的消息。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md?utm_source=chatgpt.com))

### 3. 最适用场景

软件开发、数据分析、实验流程、部署、文档流水线等：

> 能够提前较准确知道任务结构的 Goal。

### 4. 最大风险

**Plan Ossification——计划石化。**

第一轮模型对未来的错误预测，会被 Harness 升级成制度。

这甚至比普通 Agent 更糟：

普通 Agent 还能临场变通。

Contract VM 可能：

> 非常可靠地执行一个已经过期的计划。

防御方式只能是建立显式：

```text
INVALIDATE
REPLAN
PLAN_VERSION
```

### 5. 熔断条件

如果真实测试中频繁出现：

```text
执行不到 3 步
→ 后续计划就要重写
```

或者大量 Step 的 verifier 都只能写：

```text
LLM judge says pass
```

那么这条架构失去意义。

### 6. 48–72 小时验证实验

只支持三种 Goal：

```text
代码修改
资料调查
文档生成
```

实现：

```text
GoalContract
3-8 Steps
3 类 verifier
resume
plan invalidation
```

然后测 20 个任务中：

> 初始计划有多少 Step 最终原样执行。

如果这个比例很低，立刻停止押注完整 Plan VM。

------

# 十三、方案 B：UltraGoal Reconciler

这是我认为更有潜力的路线。

### 1. 本质逻辑

**不把长 Plan 当执行程序。**

Harness 只长期信任：

```text
GoalSpec
```

而不长期信任：

```text
Plan
```

每轮执行：

```text
OBSERVE
   ↓
RECONCILE
   ↓
PLAN short horizon
   ↓
COMMIT one action
   ↓
EXECUTE
   ↓
COLLECT EVIDENCE
   ↓
VERIFY
   ↓
UPDATE STATUS
   ↓
RECONCILE AGAIN
```

这实际上是：

> **Kubernetes Controller + Temporal + MPC for Agents。**

### 2. 落地路径

长期持久化两个核心对象：

```text
GoalSpec
GoalStatus
```

Plan 只是一份临时 Projection：

```text
GoalSpec
   ↓
Current GoalStatus
   ↓
Planner
   ↓
[S12, S13, S14]
   ↓
only S12 committed
```

S12 完成以后，S13 不自动获得执行权。

重新观察，然后决定：

```text
S13
还是
S13'
还是
回到 S8
还是
询问用户
还是
Goal 已完成
```

### 3. 最适用场景

这恰好覆盖你选择的 B：

研究、编码、产品设计、旅行规划、申请、商业分析、长时间 Agent、动态网页任务、多工具流程……

也就是：

> **任何开放世界 Goal。**

### 4. 最大风险

这条路线最大的问题不是僵化，而是：

> **无限思考 / 无限重规划。**

Agent 可能陷入：

```text
observe
plan
execute
replan
plan
replan
...
```

所以必须有一个真正的一等公民：

```text
progress metric
```

例如：

```text
acceptance criteria satisfied:
3 / 7

blocking unknowns:
4 → 2

verified artifacts:
1 → 3

critical uncertainty:
0.72 → 0.31
```

不能简单依赖“模型觉得自己有进展”。

### 5. 熔断条件

出现：

```text
连续 N Round 没有 GoalStatus 改善
连续重复相同 Action
成本超过 budget
核心假设连续失效
Verifier 长期 INCONCLUSIVE
```

就必须进入：

```text
BLOCKED
NEEDS_HUMAN
```

而不能继续烧 Token。

这里还有一个很现实的 DSH 信号：最近已经有人报告原生 goal-round 在 Agent 需要被动等待后台任务时，会因为 idle 后继续注入 goal round 而产生空转。无论该行为后续如何调整，它都说明 UltraGoal 必须明确区分 `WAITING_EXTERNAL` 与“需要继续推理”，而不能把 idle 简单理解为继续下一轮。([GitHub](https://github.com/deepseek-ai/deepseek-harness/discussions/4664?utm_source=chatgpt.com))

### 6. 48–72 小时验证实验

甚至先不要实现完整苏格拉底系统。

做：

```text
/ultragoal <objective>

GoalSpec
↓
next_action
↓
execute
↓
evidence
↓
verify
↓
reconcile
```

然后故意在任务中制造：

```text
修改文件
环境变化
工具失败
模型中断
DSH 重启
用户修改约束
```

测试它能不能：

> **不依赖旧上下文恢复正确行动。**

这比测“能不能自动执行 20 个步骤”有价值太多。

------

# 十四、我的战略判断

我会明确押 **方案 B：UltraGoal Reconciler**。

不是五五开。

因为：

> A 的上限是一个非常优秀的 Agent Workflow Engine。

而 DSH 已经有 Goal、Goal Round、Workflow 和持久 Session 这些基础组件了。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/README.md?utm_source=chatgpt.com))

B 的上限则是：

> **一种新的 Agent Goal Execution Protocol。**

你甚至可以把 UltraGoal 的一句话定义改成：

> **UltraGoal is a durable, evidence-driven goal reconciliation runtime that continuously drives observed reality toward a versioned human intent.**

中文：

> **UltraGoal 是一个持久化、证据驱动的目标协调运行时：它把模糊的人类意图编译成版本化 GoalSpec，并持续比较期望状态与真实状态，通过执行、验证和重规划推动现实收敛到目标。**

这比：

> “自动把 Goal 拆成很多步骤执行。”

高了一个明显的产品层级。

------

# 十五、这样一来，你原设计里哪些东西保留，哪些应该推翻

| 你原来的设计        | 判断       | 新设计                             |
| ------------------- | ---------- | ---------------------------------- |
| 苏格拉底澄清 Goal   | **保留**   | 变成 GoalSpec Compiler             |
| 完整步骤 JSON       | **降级**   | Projection，不是长期真理           |
| Step 前置条件       | **强化**   | 执行前必须重新验证                 |
| Step 执行步骤       | **保留**   | committed action                   |
| expected_result     | **推翻**   | Acceptance Predicate               |
| actual_result       | **推翻**   | Claim + Evidence                   |
| Harness 比较结果    | **强化**   | Verifier Pipeline                  |
| 自动进入下一步      | **推翻**   | Reconcile 后决定下一动作           |
| current_step Resume | **推翻**   | Event-sourced state reconstruction |
| 最终 regression     | **重命名** | Goal Revalidation                  |
| Goal loop           | **保留**   | Reconciliation Loop                |

特别是最后一个。

**“Regression Test”只适用于软件语境。**

既然 UltraGoal 是通用 Goal Runtime，最终阶段应该叫：

```text
GOAL_REVALIDATION
```

它的含义是：

> 从头重新检查所有 Goal-level acceptance criteria、constraints 和 invariants 是否仍然同时成立。

对于软件：

> 就是回归测试。

对于研究：

> 就是结论与证据重新交叉验证。

对于文章：

> 就是完整性、事实一致性、约束检查。

对于申请：

> 就是提交材料、项目要求、deadline、遗漏项总审计。

这样才真正通用。

------

# 十六、UltraGoal 真正应该形成的护城河

我认为不是 Socratic Skill。

也不是 JSON Schema。

甚至不是自动续跑。

这些都很容易模仿。

真正值得你投入的核心应该是 **Proof-Carrying Goal Execution**：

```text
GoalSpec
  ↓
StepContract
  ↓
Execution
  ↓
Claim
  +
Evidence[]
  ↓
Verifier[]
  ↓
Decision
  ↓
GoalStatus transition
```

其中 Verifier 至少要逐渐形成下面五级能力：

1. **Deterministic verifier**：exit code、测试、JSON predicate、文件 hash、HTTP status。
2. **Artifact verifier**：文件存在、字段存在、diff、schema、编译产物。
3. **External-state verifier**：重新查询网页/API/数据库确认现实状态。
4. **Semantic verifier**：LLM/rubric 判断复杂自然语言成果。
5. **Human verifier**：真正无法机器证明的 acceptance criterion 交回用户。

越靠上越可信。

**能用 1，就绝不使用 4。**

这一条如果做成 UltraGoal 的核心原则，我认为会非常漂亮。

------

而且现在重新看 DSH 本身的架构，会发现它其实非常适合这么干：Skills 本身只是模型指令而非 session event；原生 Goal 已经是 event-sourced durable objective；`agent/pre-step` 可以控制下一步模型看到什么；工具执行和 session event 又可以提供证据来源。也就是说，你真正应该新增的是 **Goal Contract / Evidence / Verifier / Reconciler 这一层**，而不是再造一个 Agent Loop。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md?utm_source=chatgpt.com))

**所以我现在对 UltraGoal 的战略评价已经从“这是一个不错的 DSH 插件机制”变成了：如果按 Reconciler 路线做，它有机会成为 DSH 原生 `/goal` 之上的第二代 Goal Runtime。** 原生 `/goal` 解决的是“我要一直做这件事”；UltraGoal 应该解决的是：

> **“你凭什么证明，你一直做的事情正在把现实推向我真正要的目标？”**

这才是 UltraGoal 最值得做的那一层。