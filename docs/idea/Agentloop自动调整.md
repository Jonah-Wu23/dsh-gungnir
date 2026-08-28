我按你上传的「三元棱镜与跨域推演双轨工作流」完整跑下来。这个 Skill 要求先做第一性原理、跨域映射和三视角对抗，最后故意撕裂成两条完全不同的路线，而不是给一个折中答案。

先给结论：

> **你真正应该开发的东西，不是“一个会自动切换的 Agent Loop”。**
>
> 而应该是一个位于 Agent Loop 之上的 **Adaptive Loop Control Plane——自适应循环控制平面**。
>
> `agent-loop` 继续负责“怎么转”；新的控制平面负责“现在应该怎么转”。

而且这里有一个非常反直觉、但我认为是整个项目最关键的判断：

> **不要把 Research / Plan / Code / Verify / Ralph 做成五个一级“Loop Mode”。**
>
> `Mode` 应该只是若干独立策略维度在某一时刻组合出来的**涌现状态**。

这会决定你的项目最后是一个“模式切换插件”，还是一个真正有机会成为 Harness 基础设施的东西。

------

# 一、第一性原理破壁：Agent Loop 到底是什么？

先把 ReAct、Plan-and-Execute、Ralph、Workflow、Reflection 这些名字全部剥掉。

Agent 干的事情本质上只有：

**观察当前状态 → 决定下一步计算方式 → 执行 → 得到新状态 → 判断下一步。**

所以所谓不同 Agent Loop，真正不同的并不是那个 `while(true)`。

不同的是：

- 下一步要不要先思考；
- 思考多远；
- 是自己做还是分派；
- 是串行还是并行；
- 是否允许修改环境；
- 要不要独立验证；
- 失败以后继续、回滚还是换方法；
- 保留上下文还是重新开一个干净 Agent；
- 用便宜模型还是强模型；
- 达到什么证据以后才能停止。

因此：

> **Loop ≠ 循环代码。**
>
> **Loop = 一组随状态变化的控制策略。**

DSH 本身其实已经证明了这一点。

当前 DeepSeek Harness 的真正 `agent-loop` 非常薄，它只负责 Session → Turn → Step → Model → Tool → 下一 Step 的生命周期；官方明确要求新行为优先做成插件，而不是塞进 concrete loop。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md?utm_source=chatgpt.com))

更关键的是，现在已经存在好几种“看起来像不同 loop”的东西：

- Goal Round：同 session 持续推进目标；
- Ralph：每轮启动一个全新的 child；
- Dynamic Workflow：模型生成 orchestration script；
- Plan Mode：改变当前协作策略；
- Compaction：上下文压力时改变处理方式；
- Subagent：改变执行拓扑。

但它们**都没有成为 `agent-loop` 的分支**。尤其 Ralph 官方明确写了：这是一种 specialized orchestration policy，不应该增加 Ralph mode，也不应该修改 concrete agent loop。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/README.md?utm_source=chatgpt.com))

所以你的项目真正的问题应该重新写成：

> **如何让 Harness 根据目标、任务阶段、执行反馈和环境变化，动态选择并组合不同的“控制策略”，同时维持同一个 durable objective、session state 和安全边界？**

这和“热切换 Agent Loop”已经是两个问题了。

------

# 二、当前最大的错误假设：把 Loop Mode 当一级实体

DSH 官方其实已经踩过这个坑。

Plan Mode 的设计讨论里，官方明确反对把 Plan Mode、Sandbox Mode 等抽象成一个统一的 generic mode，因为它们属于**不同策略域、不同 owner、不同状态语义**。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md?utm_source=chatgpt.com))

这对你非常重要。

假如你设计：

```text
mode = research
mode = plan
mode = execute
mode = verify
mode = ralph
```

很快就会出现：

```text
research + parallel?
plan + read-only?
execute + cautious?
execute + parallel?
verify + fresh-context?
research + fresh-agent?
recover + high-reasoning?
```

然后模式数量组合爆炸。

所以真正应该存在的不是：

```text
CurrentLoopMode
```

而是类似：

```text
LoopPolicyVector
├── cognition
├── orchestration
├── continuation
├── verification
├── context strategy
├── model strategy
└── action strategy
```

例如：

```text
cognition:
  reactive | deliberate | exploratory

orchestration:
  direct | subagent | workflow | fresh-agent

continuation:
  natural-stop | goal-round | forced-continue

verification:
  none | self-check | independent-check

context:
  same-session | compact | fresh-context

model:
  cheap | balanced | strong

action:
  inspect | modify | validate
```

注意其中一些策略只应该是**建议/协作策略**；真正的 sandbox、approval 等安全 authority 仍由原来的 owner 控制，不能让 Adaptive Loop 抢走所有权。

于是“Research Mode”变成：

```text
exploratory
+ workflow
+ natural-stop
+ independent-check
+ same-session
+ balanced
+ inspect
```

“Coding Execution”可能是：

```text
reactive
+ direct
+ goal-round
+ self-check
+ same-session
+ balanced
+ modify
```

而代码写完以后，只变化两个维度：

```text
action: modify → validate
verification: self-check → independent-check
```

它根本不需要执行一次巨大的：

> SWITCH LOOP FROM CODE TO VERIFY

这就是第一处范式变化。

------

# 三、真正的核心矛盾

你的系统实际上面对的是：

### 自适应性 vs 可预测性

如果一切固定：

```text
ReAct → ReAct → ReAct → ReAct
```

非常稳定，但面对不同任务明显低效。

如果模型拥有完全权限：

```text
“我觉得现在应该换 loop。”
“我觉得再换一个。”
“现在我开 8 个 subagent。”
“现在换 Ralph。”
```

系统会变成一个高自由度、不可复现的控制系统。

尤其危险的是：

> **执行任务的 Agent 同时负责判断“自己现在应该用什么思考机制”。**

这是一个典型的 self-reference 问题。

因此真正的关键不是“让模型切模式”，而是：

> **谁拥有 Loop Transition Authority？**

------

# 四、跨领域映射：别把它当 Agent 问题

这里有几个非常漂亮的同构体。

## 1. TCP 拥塞控制：最像你这个问题

TCP 并不是始终运行一个固定策略。

同一连接会根据环境反馈，在：

- Slow Start
- Congestion Avoidance
- Fast Retransmit
- Fast Recovery

之间切换。

但它并没有：

> “运行中换一个 TCP 实现。”

真正做法是：

```text
稳定协议内核
+
状态变量
+
环境信号
+
状态转换规则
```

例如 `cwnd` 与 `ssthresh` 决定当前采用不同算法；出现丢包又进入恢复策略。([RFC 编辑器](https://www.rfc-editor.org/info/rfc5681/?utm_source=chatgpt.com))

迁移到 Agent：

```text
固定 Agent Runtime
+
Loop State
+
Execution Telemetry
+
Transition Policy
```

而且 TCP 给你的另一个重要启发是：

> **切换必须有 threshold 和 hysteresis。**

否则 Agent 会出现：

```text
Explore
↓
Execute
↓
Explore
↓
Execute
↓
Verify
↓
Execute
```

疯狂振荡。

所以必须有：

- minimum dwell steps；
- transition cooldown；
- evidence threshold；
- switching cost；
- failure counter；
- fallback state。

------

## 2. 机器人 Behavior Tree

Behavior Tree 的核心价值并不是“树”。

而是：

> 把复杂行为拆成模块，每个模块不断报告 Running / Success / Failure / Applicability，然后上层根据环境实时决定执行哪个分支。

这就是“在任务执行中动态改变策略”，而且强调模块化、层级结构和反馈。([Annual Reviews](https://www.annualreviews.org/content/journals/10.1146/annurev-control-042920-095314?utm_source=chatgpt.com))

迁移过来：

每一个 Loop Strategy 都不应该只写一个 prompt。

它应该声明：

```text
canEnter(state)
canContinue(state)
successCondition
failureCondition
entryPolicy
exitPolicy
```

也就是说：

> **Loop Strategy 是一个具有进入条件和退出条件的控制模块。**

------

## 3. Autonomic Computing 的 MAPE-K

自适应系统经典结构是：

```text
Monitor
   ↓
Analyze
   ↓
Plan
   ↓
Execute
   ↓
Monitor
```

并共享一个 Knowledge 状态。

关键在于：

> **负责“调整系统”的循环，与真正执行业务的循环是分开的。**

这正是你的系统应该变成的样子。([IEEE Technology Navigator](https://technav.ieee.org/topic/autonomic-systems/?utm_source=chatgpt.com))

也就是两个时钟：

```text
Fast Loop
Agent:
Think → Tool → Result → Think
```

以及：

```text
Slow Loop
Meta Controller:
Observe → Evaluate → Change Loop Policy
```

这意味着你的东西本质上是：

# Meta-Loop

而不是另一个 Agent Loop。

------

## 4. 历史上的 Mission Command

十九世纪发展出的 Auftragstaktik / Mission Command 有一个非常类似的结构：

上级稳定规定：

- 目的；
- 意图；
- 边界。

但具体执行方法允许下级根据现场变化决定。其思想正是：远程上级给出的具体行动命令很容易因为环境变化而过期，因此必须允许执行单元在稳定意图下调整方法。([陆军进修出版社](https://www.armyupress.army.mil/Journals/Military-Review/English-Edition-Archives/July-August-2022/Herrera/?utm_source=chatgpt.com))

映射过来非常漂亮：

```text
Goal
= Commander's Intent
```

应该尽可能稳定。

而：

```text
Loop Policy
= Tactical Method
```

应该可以频繁改变。

所以必须强制：

> **Goal State 和 Loop State 完全分离。**

这是你之前 UltraGoal 思路和 Adaptive Loop 最适合衔接的地方。

Goal Controller 说：

> 我要到哪里。

Adaptive Loop 说：

> 现在应该怎么走。

Agent Loop 说：

> 我执行这一小步。

三个层次绝不能混。

------

# 五、三视角对抗

## 视角一：控制理论

它会说：

> 这根本不是一个 prompt engineering 问题，而是 hybrid control system。

它最支持：

```text
Stable Plant
+
State Estimator
+
Policy Controller
```

也就是不要修改底层 loop。

它最害怕模型拥有 transition authority，因为容易发生振荡。

它认为最重要的指标不是“模型觉得哪个模式合适”，而是：

```text
progress_delta
error_rate
repeat_count
uncertainty
validation_debt
context_pressure
budget_remaining
```

### 它什么时候认错？

如果经过大量任务以后发现：

> 不同高级任务所需要的控制结构无法用有限策略轴表达，

那就证明“固定内核 + policy vector”表达力不足。

------

# 六、视角二：编程语言 / OS Kernel

这个视角会更加激进。

它会说：

> 既然 DSH 的 agent-loop 本来就是 swappable implementation，那为什么还假设 Turn/Step 是永恒不变的？

它会进一步问：

为什么：

```text
Model → Tools → Model
```

一定是唯一基本执行结构？

某些任务可能应该：

```text
Plan
↓
N workers parallel
↓
Judge
↓
Repair failed branches
↓
Merge
```

另一些可能：

```text
Fresh Agent
↓
Result
↓
Fresh Agent
↓
Result
```

还有：

```text
Actor ↔ Critic
```

所以它会支持创建真正的：

> **Loop VM / Loop Runtime**

把不同循环本身声明成程序。

### 它什么时候认错？

如果实际测试发现 90% 以上任务变化都只是：

- prompt；
- tools；
- continuation；
- verification；
- model；
- subagent strategy；

那么重新造 Loop VM 就是过度设计。

------

# 七、视角三：机制设计 / Agent 治理

这个视角会问一个更麻烦的问题：

> 为什么相信 Agent 对自己的评价？

例如模型说：

```json
{
  "progress": 0.93,
  "recommended_mode": "finish"
}
```

这不能成为可靠证据。

否则 Agent 为了早点停止，可以同时：

1. 完成任务；
2. 判断任务是否完成。

因此它主张：

```text
Agent = propose transition
Harness = authorize transition
Environment = provide evidence
```

例如模型可以调用：

```text
propose_loop_transition(...)
```

但 Harness 根据：

- 测试结果；
- 文件 diff；
- tool outcome；
- unresolved todo；
- goal predicates；
- errors；
- validator；

决定是否真的切换。

这个视角最支持：

> **模型有建议权，Harness 有裁决权。**

------

# 八、三方共同结论

这里三种视角其实达成了几个很强的共识。

### 第一，共识：绝对不要“运行中热换 Agent 实现”

DSH 的 Turn/Step、Inbox、Cancellation、Session Log 都存在严格生命周期。

你真正应该切的是：

```text
Policy
```

而不是：

```text
ReactLoopAgent instance
```

至少不要在一个 Step 中间切。

------

### 第二，共识：切换是状态转换，不是 prompt

每次变化至少应该形成：

```json
{
  "from": "...",
  "to": "...",
  "reason": "...",
  "evidence": [...],
  "trigger": "...",
  "turn": 7,
  "step": 19
}
```

并进入 durable Session Log。

DSH 自己有一个非常硬的原则：

> 模型可见的东西必须能够从 session log 重构。

官方的 Plan Mode 也是把状态记录进日志，因此 resume、fork、compaction 后仍可以恢复。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/plan.md?utm_source=chatgpt.com))

你的 Adaptive Loop 必须继承这条原则。

------

### 第三，共识：真正需要自动调整的是一个 policy vector

因此我暂时把整个系统称为：

# Loop Control Plane

结构应该是：

```text
                   ┌─────────────────┐
                   │      Goal       │
                   │ invariant state │
                   └────────┬────────┘
                            │
                            ▼
┌────────────┐     ┌─────────────────┐
│ Session /  │────▶│   Loop State    │
│ Tool Events│     │    Estimator    │
└────────────┘     └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ Policy Resolver │
                   └────────┬────────┘
                            │
                   transition proposal
                            │
                            ▼
                   ┌─────────────────┐
                   │Transition Guard │
                   └────────┬────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │ Active Loop Policy Vector│
              └─────────────┬────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
       Prompt          Tools/Guard      Orchestration
           │                │                │
           └────────────────┼────────────────┘
                            ▼
                     DSH Agent Loop
```

------

# 九、方案 A：Loop OS —— 不改 agent-loop 的自适应控制平面

这是**内向结构重构路线**。

核心假设：

> 当前 DSH 的 Turn/Step 执行骨架已经足够通用；真正缺的是一个协调现有策略插件的控制平面。

DSH 当前已经提供：

- `agent/inbox/claimed`
- `agent/pre-step`
- `agent/request`
- `agent/request-error`
- `agent/turn-stopping`
- `tools/*`
- `agent.ctx`
- System Prompt scoped contributions
- scoped tool restrictions
- Goal
- Workflow
- Ralph
- Subagent

所以你不用重新造执行器。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md?utm_source=chatgpt.com))

甚至模型 route 本来就允许在 `agent/request` waterfall 中动态改变 provider、model、reasoning effort、sampling。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md?utm_source=chatgpt.com))

### Loop OS 负责什么？

维护：

```text
AdaptiveLoopState
```

根据事件更新：

```text
ambiguity
progress
stagnation
failure
risk
contextPressure
parallelizability
verificationDebt
budget
```

然后输出：

```text
LoopPolicyVector
```

例如一个 Coding Goal：

```text
① Explore
   ↓
② Deliberate
   ↓
③ Execute
   ↓
④ Parallelize
   ↓
⑤ Recover
   ↓
⑥ Verify
   ↓
⑦ Finish
```

过程中根本不存在一个固定“Coding Loop”。

它是运行时长出来的。

### 自动切换例子

用户：

> 给这个仓库修一个并发 bug。

开始：

```text
cognition = exploratory
action = inspect
orchestration = direct
```

找到涉及六个模块：

```text
orchestration → workflow
```

得出根因：

```text
cognition → deliberate
```

开始修改：

```text
action → modify
```

连续三次测试出现相同 failure signature：

```text
cognition → recover
model → strong
```

测试通过：

```text
action → validate
verification → independent
```

Verifier 发现 regression：

```text
verification → repair
```

再次通过：

```text
finish
```

这才是我理解的真正：

> **Agent Loop 自动调整。**

### 最大风险

Policy Controller 自己变成第二个巨大 Agent。

最后：

```text
Agent 思考一次
Meta Agent 再思考一次
Agent 做一步
Meta Agent 又思考一次
```

成本直接翻倍。

因此 A 必须采用：

> **event-driven，不是每 step 都重新让 LLM 决策。**

简单信号由规则决定。

只有真正模糊的 transition 才调用 meta-model。

### 熔断条件

如果实验显示：

> 大量高价值任务需要改变 Turn/Step 本身的拓扑，而不是改变其上的策略，

立即停止继续给 Loop OS 加 patch。

说明需要方案 B。

### 48–72 小时验证实验

只做三个策略：

```text
EXPLORE
ACT
VERIFY
```

但内部仍保存 policy vector。

实现：

```text
loop/state
loop/transition
```

两个 durable events。

接：

```text
agent/inbox/claimed
tools/result
agent/request-error
agent/turn-stopping
```

只使用：

- prompt policy；
- tool execution gate；
- reasoning/model route；
- force continue；
- verifier。

选 20 个 coding / research 混合任务。

比较：

```text
fixed loop
vs
adaptive loop
```

只看：

- 成功率；
- tool calls；
- token；
  -错误重复次数；
- 完成前 verification 覆盖率；
- transition 次数。

这个实验能非常快判断这个方向是不是假的。

------

# 十、方案 B：Loop VM —— 让 Agent Loop 本身变成“可编程机器”

这是完全相反的路线。

不是：

> 不修改 agent-loop。

而是：

> **承认现在的 Agent Loop 只是一种 Loop，实现一个新的 Agent contract implementation。**

DSH 本来就刻意让插件依赖 `Agent` 而不是具体 `agent-loop`，目的就是让 driver 可替换。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/README.md?utm_source=chatgpt.com))

于是创建：

# AdaptiveLoopAgent

它不运行固定：

```text
Turn
  Step
    Model
    Tools
```

而运行：

```text
LoopProgram
```

比如：

```json
{
  "nodes": [
    {"type": "reason"},
    {"type": "parallel", "workers": 4},
    {"type": "judge"},
    {"type": "repair_if_failed"},
    {"type": "verify"},
    {"type": "finish_if"}
  ]
}
```

任务进行过程中允许：

```text
LoopProgram(t)
→
LoopProgram(t+1)
```

因此真正意义上的：

> **Self-Modifying Agent Loop**

出现了。

Coding 可以生成一个：

```text
Explore → Plan → Act → Test → Repair*
```

Research 自动生成：

```text
Clarify
→ Parallel Research
→ Cross-check
→ Contradiction Resolution
→ Synthesis
```

数学证明可能：

```text
Construct
↔ Critic
→ Counterexample Search
→ Formal Verify
```

完全不存在预定义 Mode。

### 这条路线为什么诱人？

因为它真正实现：

> **不是选择 Loop，而是生成 Loop。**

DSH 已经有 Dynamic Workflow 这个思想的雏形：模型可以写 JavaScript orchestration script，让 script 本身持有 branching、loop 和 intermediate results，而不是让父 Agent 每一步重新做 orchestration。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md?utm_source=chatgpt.com))

你的 Loop VM 可以把这个思想继续向上推一层。

Dynamic Workflow 是：

> 一个工具内部动态生成 workflow。

Loop VM 是：

> Agent 自身运行的控制程序动态生成。

这个想法理论上非常猛。

### 最大风险

你会无意中开始重新实现：

- Agent Loop；
- Workflow Engine；
- Goal；
- Subagent；
- Scheduler；
- Recovery；
- Replay；
- State Machine；
- Policy Engine。

最后做出一个“DSH 里面的另一个 Harness”。

而且验证复杂度会指数级增长。

### 熔断条件

如果 50–100 个真实任务表明：

> 绝大多数所谓不同 Loop，其实都能分解成 prompt / tool / continuation / orchestration / verification / context 几个策略轴，

就立即杀掉 Loop VM。

因为那意味着它没有创造新的表达能力。

### 48–72 小时实验

不要开发完整 VM。

只实现一个替代 driver prototype，支持四个 primitive：

```text
MODEL
DELEGATE
VERIFY
CONTINUE
```

以及：

```text
IF
GOTO
STOP
```

然后让 10 个复杂任务生成自己的 `LoopProgram`。

和普通 DSH + Workflow 对比。

唯一要回答的问题：

> 有没有任务明显因为“改变 Loop topology”而获得现有插件组合无法实现的优势？

如果没有，B 就不值得做。

------

# 十一、A 和 B 真正的分界线

不是“哪个更酷”。

而是一个非常具体的问题：

> **任务执行过程中真正需要变化的，到底是 Loop 的策略，还是 Loop 的语法？**

如果变化的是：

```text
思考深度
工具
模型
上下文
验证
并行度
继续条件
fresh-agent
```

那么选 **A：Loop OS**。

如果变化的是：

```text
谁先执行
谁等待谁
哪里形成 barrier
哪里递归
哪里 fork
哪里 merge
哪里开启新的 reasoning process
```

那么才需要 **B：Loop VM**。

------

# 十二、我现在的战略判断

现阶段我大约 **80% 倾向方案 A**。

原因不是它简单，而是因为 DeepSeek Harness 的架构其实已经在用事实告诉我们：

> **很多看似完全不同的 Agent Loop，本来就应该是独立 policy plugins。**

Goal、Ralph、Workflow、Plan Mode 已经分别证明了这一点。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/README.md?utm_source=chatgpt.com))

所以你现在最有价值的创新不是再增加：

> 第 N 种 Loop。

而是增加：

> **能够观察这些能力、选择这些能力、组合这些能力、自动转换这些能力的上层控制系统。**

换句话说：

# Everything is a Plugin

下一步很可能应该变成

# Everything is a Policy, and Policies Adapt.

而且你前面构思的 **UltraGoal** 和这个东西其实恰好位于上下两层：

```text
┌─────────────────────────────┐
│ UltraGoal                    │
│ What must become true?       │
├─────────────────────────────┤
│ Adaptive Loop Control Plane  │
│ How should I work NOW?       │
├─────────────────────────────┤
│ DSH Agent / Goal / Workflow  │
│ Execute the chosen policy    │
├─────────────────────────────┤
│ Tools / LLM / Sandbox        │
│ Perform actual operations    │
└─────────────────────────────┘
```

**这两个项目一旦接起来，才开始像一个真正意义上的“自适应 Harness”。**

而不是单纯的 Agent 自动换模式。