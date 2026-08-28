基于你上传的 SKILL，我的结论会和你引用的那段“Gungnir 选择克制、不替换 loop”明显不同：

> **如果 Gungnir 的核心产品使命就是“让 Agent 根据任务状态动态改变自己的执行机制”，那就应该替换 DeepSeek Harness 默认 agent-loop。**
>
> 但不是在运行中粗暴地“卸载 A loop 插件 → 装载 B loop 插件”，而是：**一次性替换默认 loop 为一个稳定的 Adaptive Meta-Loop Runtime，再由这个 runtime 在任务过程中动态切换不同的 loop strategy/state machine。**
>
> **append-only Session Log 保留。换的是执行状态机，不是历史账本。**

这两者并不冲突。事实上，DeepSeek Harness 自己的架构恰好支持这个方向。

你的 SKILL 要求先从第一性原理拆掉既有术语和假设，再寻找跨领域同构，最后从真正冲突的假设中撕出两条完全不同路线，而不是折中。

------

# 一、先纠正一个会把整个设计带偏的前提

原论述里最重要的一句是：

> “替换机制会直接击穿 append-only 可信事件脊柱。”

**以目前 DeepSeek Harness 的实际架构来看，这个判断过强，甚至方向上是错的。**

DSH 把：

- `core/session`：append-only `SessionEvent` 日志；
- `core/agent`：公共 Agent 接口；
- `core/agent-loop`：默认具体 driver；

分成了三个独立层次。

而官方文档明确写了：**agent-loop 本身就是可替换组件，其他插件依赖 `agent` 接口，而不是依赖默认 agent-loop。** ([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md?utm_source=chatgpt.com))

甚至 DSH 的微内核架构决策里明确把：

> `/goal`、`/loop`、dynamic workflows、compaction、sandboxing……

列为应该在微内核扩展体系中实现的能力。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-06-11-microkernel-event-taxonomy.md?utm_source=chatgpt.com))

所以正确的层次应该是：

```text
错误理解：

Append-only Log
      │
Default Agent Loop
      │
Plugins
      │
动态控制

因此换 Loop = 换掉账本基础


正确理解：

                ┌── Default ReactLoop
Agent Contract ─┼── Gungnir AdaptiveLoop
                ├── Future Loop X
                └── Future Loop Y
                         │
                         ▼
                 Session Event Log
                 append-only truth
```

**Session log 是事实层。**

**Agent loop 是执行层。**

你完全可以把执行层换掉，同时继续忠实地产生：

```
turn/start → step/start → request → tool/call → tool/result → step/end → turn/end
```

这一类 durable events。

因此真正应该禁止的是：

> **rewrite history**

而不是：

> **replace execution policy**

这两个概念必须彻底分开。

------

# 二、第一性原理：你到底在造什么？

把 “dynamic agent-loop” 这个词扔掉。

你实际上想解决的是：

> **现在 Agent 在所有情况下基本使用同一种“思考→调用→观察→再思考”的控制算法，但不同任务阶段真正需要的控制算法完全不同。**

比如：

```text
“这个文件存在吗？”
```

根本不应该：

```text
LLM深思
→ tool
→ 把全部history发给LLM
→ 深思
→ tool
→ 全部history再发一次
```

应该：

```text
检查文件
→ true
```

而：

```text
“为什么这个分布式系统偶发死锁？”
```

可能值得：

```text
建假设
→ 收集证据
→ 并行验证
→ 反证
→ 收敛
```

而：

```text
“把这40个文件全部检查一遍”
```

应该：

```text
写一次执行程序
→ 40个工具调用
→ 并发执行
→ 聚合结果
→ 一次回给模型
```

所以你真正研究的不是：

> **Agent Loop Replacement**

而是：

# **Adaptive Cognitive Scheduling**

也就是：

> 给 Agent 一个“认知调度器”。

这其实和操作系统调度 CPU 很像：

```text
任务不同
↓
使用不同 scheduling policy

I/O bound
CPU bound
real-time
batch
interactive
```

LLM Agent 同样存在：

```text
简单确定任务
探索任务
执行任务
验证任务
等待任务
恢复任务
高风险推理任务
```

为什么必须都跑 ReAct？

没有第一性原理要求如此。

------

# 三、现在 DSH 已经证明了你的一半判断是对的

这里有一个很重要的现实。

DeepSeek Harness 现在已经拥有 Code Mode/PTC。

它允许模型不是：

```text
LLM
↓
tool A
↓
LLM
↓
tool B
↓
LLM
↓
tool C
↓
LLM
```

而是：

```text
LLM
↓
生成一段程序
↓
tool A
tool B
tool C
...
↓
返回精选结果
↓
LLM
```

官方 preset 甚至直接说明：原本大约五次模型往返的序列可以压成一次。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/config/agent-presets/code/agent.cordis.yml?utm_source=chatgpt.com))

更重要的是，Code Mode 的**中间工具结果不会全部重新进入模型上下文**，只有程序最终输出重新进入 conversation。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md?utm_source=chatgpt.com))

Native tool call 现在也已经支持安全调用的有界并行：

```text
read A ┐
read B ├ parallel
read C ┘
   ↓
write A
```

同时仍然按照模型原始调用顺序提交 durable result，维持审计性。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md?utm_source=chatgpt.com))

Dynamic Workflows 更进一步：DSH 官方承认，让模型自己一轮一轮编排多 Agent 会造成：

- intermediate result 污染 parent context；
- 每一步都需要模型 round-trip；
- plan 没有真正存在 runtime 里。

所以现在已经把 orchestration loop 搬进 JavaScript workflow runtime。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md?utm_source=chatgpt.com))

这件事特别重要。

因为它实际上已经证明：

> **“把控制循环从 conversation/model 搬到 runtime”是成立的。**

所以你不是在逆 DSH 架构而行。

你是在把 DSH 已经零散出现的趋势继续向上抽象一层。

------

# 四、但这也意味着：仅仅“批量调用工具”已经不够资格成为 Gungnir 的核心创新

这是你现在需要警惕的地方。

你刚刚说的很多收益：

- 一次安排多个工具调用；
- 减少 LLM round-trip；
- 中间结果不回灌；
- 降低 input token；
- 工具并行；
- 提升 KV cache；

**DSH Code Mode/PTC 已经吃掉相当一部分。**

因此如果 Gungnir 最终只是：

> “我也做一个 smarter tool batching。”

战略价值会迅速缩水。

真正没有被统一解决的是：

# **谁决定什么时候使用什么执行循环？**

比如一个任务：

```text
用户目标
   │
   ▼
① Goal clarification
   │
   ▼
② Planning
   │
   ▼
③ Fast execution
   │
   ├────→ 批量工具
   │
   ▼
④ Deterministic validation
   │
   ├─pass────→继续
   │
   └─fail
       │
       ▼
⑤ Recovery / hypothesis search
       │
       ▼
⑥ Deep reasoning
       │
       ▼
⑦ Retry
       │
       ▼
⑧ Regression verification
```

现在这些东西分别可能由：

- prompt；
- skill；
- Code Mode；
- workflow；
- hook；
- retry plugin；
- subagent；
- model router；

各自完成。

**没人拥有整个认知控制状态机。**

这才是你的切口。

------

# 五、核心矛盾其实不是“可信 vs 动态”

真正的核心矛盾是：

## **Mechanism Stability vs Policy Plasticity**

即：

> 哪些东西必须稳定，哪些东西应该动态变化？

我认为必须稳定的是：

```text
Agent Contract
Session identity
Append-only event ledger
Tool safety/permission
Cancellation semantics
Persistence
Replay semantics
Observability
```

应该允许疯狂变化的是：

```text
context projection
model
reasoning budget
tool presentation
tool execution strategy
branching policy
validation policy
retry policy
stop condition
planning depth
subagent topology
workflow strategy
```

这其实恰好符合 DSH 的微内核哲学。

------

# 六、跨领域映射：三个非常强的同构体

你的 SKILL 要求不是简单举例，而是找到“底层机制相同”的远领域问题。

### 1. 操作系统：Mechanism / Policy separation

操作系统不会为了不同程序重新发明：

```text
memory
process
interrupt
filesystem
```

但 scheduler 可以不同：

```text
interactive
real-time
fair scheduling
batch
```

迁移到 Gungnir：

```text
DSH primitives
=
kernel mechanism

Gungnir Loop Strategy
=
scheduler policy
```

**启示：**

不要动态重建整个 Agent Runtime。

要建立稳定 runtime + 可动态切换 scheduling policy。

失效条件：

> strategy 对底层资源状态完全不可观测。

所以你的 meta-loop 必须拿到足够 telemetry。

------

### 2. Event Sourcing / MVCC：事实 ≠ 当前视图

这是你解决“删除致错上下文”的关键。

很多人错误地认为：

```text
日志不可删
=
模型必须永远看到全部日志
```

完全不是一回事。

可以：

```text
Immutable Event Ledger
             │
             ▼
      Context Projector
             │
        ┌────┼─────┐
        ▼    ▼     ▼
       View A View B View C
```

事件：

```text
E1 E2 E3 E4 E5 E6
```

永远保留。

但当前 reasoning context 可以是：

```text
E1 E2 E4 E6
```

甚至：

```text
summary(E1-E4) + E6
```

或者：

```text
fork(boundary=E3)
```

DSH 本身已经有 session fork，而且要求 fork boundary 位于稳定的 closed-turn 前缀上。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.zh.md?utm_source=chatgpt.com))

因此：

# **Context deletion 应该是 projection，不是 ledger mutation。**

这一点直接破解了原方案最大的思想锁死。

------

### 3. TCP / 自适应控制系统：动态模式切换

TCP 不会：

> “因为之前网络拥堵，所以以后永远保持同一个窗口。”

它根据 feedback 改变控制状态。

Agent 也一样：

```text
progress ↑
confidence ↑
      ↓
Fast mode
```

如果：

```text
重复失败
无新证据
tool调用循环
低信息增益
```

就进入：

```text
Recovery
```

如果发现：

```text
多个高概率假设
```

进入：

```text
Branch Search
```

真正可以迁移的是：

> **mode transition 应由反馈信号触发，而不是让 LLM凭感觉无限思考。**

------

### 4. 飞行控制：Mode switching 的最大危险不是模式本身，而是 mode confusion

这是你的最大工程风险。

一个 Agent 如果这样：

```text
REFLEX
↓
PLAN
↓
REFLEX
↓
VERIFY
↓
PLAN
↓
SEARCH
↓
PLAN
...
```

你会得到一个新的灾难：

# loop thrashing

于是 meta-loop 自己开始烧 token。

所以必须加入：

```text
hysteresis
minimum dwell time
transition cost
switch budget
circuit breaker
```

换句话说：

> **动态 loop 最大的敌人不是 hallucination，而是控制器振荡。**

------

# 七、三种视角的对抗

你的 SKILL 要求三种互补视角分别给出定义、路线、盲区和证伪条件。

| 视角                | 判断                                                         |
| ------------------- | ------------------------------------------------------------ |
| **微内核/系统架构** | 换 loop。因为 DSH 已经把 loop 明确定义为可替换 driver，session ledger 独立存在。 |
| **控制理论/决策论** | 换，而且必须做 meta-controller。固定 ReAct 本质上是用一个 controller 覆盖所有状态。 |
| **可靠性/验证工程** | 强烈反对任意时刻 hot-swap 实例，但不反对替换默认 loop；要求所有 transition 可观测、可重放、有 stable boundary。 |

三方共同承认：

> **执行策略可以变化，事实历史不能偷偷变化。**

真正分歧只剩：

> 动态性应该进入多深？

可靠性派认为：

```text
hooks + seam
```

足够。

控制理论派认为：

```text
必须拥有 state transition graph
```

否则无法做到真正 adaptive。

我站后者。

------

# 八、方案 A：真正替换默认 Agent Loop —— 我推荐这一条

## Gungnir Adaptive Loop Runtime

这不是：

```text
plugin A unload
plugin B load
plugin C unload
```

而是启动时：

```text
@deepseek-ai/dsh-agent-loop
            ↓ replace
@gungnir/adaptive-agent-loop
```

然后以后整个 session 生命周期里都是：

```text
AdaptiveLoopAgent
```

它内部拥有：

```text
LoopStrategy interface
```

例如：

```text
REFLEX
EXECUTE
CODE
WORKFLOW
DELIBERATE
VERIFY
BRANCH
RECOVER
WAIT
FINALIZE
```

Meta-controller 决定：

```text
state_t
+
observations_t
+
goal
+
budget
+
risk
↓
strategy_{t+1}
```

------

## 它真正应该动态换的东西

不是“提示词风格”。

而是：

```text
下一次需不需要调用 LLM
哪一个模型
reasoning effort
model context projection
工具呈现 native/code
是否批执行
是否并行
是否 fork
是否启动 subagents
是否执行 deterministic validator
失败后 retry / replan / branch / stop
什么时候终止
```

这才叫：

# **Dynamic Agent Loop**

------

# 九、我会把第一版 loop mode 收缩成 6 个

千万别 MVP 就做 15 个。

```text
                 ┌─────────────┐
                 │   ROUTER    │
                 └──────┬──────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
    REFLEX            EXECUTE        DELIBERATE
  快速直觉模式        干活模式          深思模式
       │                │                │
       └───────┬────────┴──────┬─────────┘
               ▼               ▼
             VERIFY         RECOVER
               │               │
             pass            branch/
               │             replan
               ▼
             FINISH
```

然后把 WAIT 作为运行状态，不一定算 cognitive strategy。

### REFLEX

目标：

> **能不思考就不思考。**

便宜模型 / low reasoning。

适合：

- 明确问答；
- 单步决定；
- obvious next action；
- 简单分类。

------

### EXECUTE

原则：

> **模型不要一边拧螺丝一边重新思考人生。**

自动优先：

```text
Code Mode
Workflow
parallel tools
```

让 runtime 干活。

这正好利用 DSH 已有的 Code Mode 能力，而不是重造它。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/code-mode.ts?utm_source=chatgpt.com))

------

### DELIBERATE

只有出现：

```text
high uncertainty
high consequence
conflicting evidence
novel planning
```

才调用高 reasoning 模型。

这就是你说的：

> **不要“雷霆大思考”成为默认模式。**

Deep CoT 应该变成昂贵的 exception path。

------

### VERIFY

优先顺序应该是：

```text
deterministic check
↓ 不行
cheap verifier
↓ 不行
independent LLM judge
```

而不是反过来。

这里能大量消灭：

> “LLM 让另一个 LLM 看看自己对不对。”

------

### RECOVER

检测：

```text
重复工具
重复结论
没有信息增益
连续验证失败
相同错误N次
```

就停止正常 loop。

然后：

```text
identify bad assumptions
         ↓
context projection
         ↓
fork stable boundary
         ↓
new strategy/model
```

注意：

**原始错误仍然留在 ledger。**

只是新的 working view 不再把它当 authoritative context。

------

### FINALIZE

独立于执行。

检查：

```text
goal expected outcome
vs
actual outcome
```

而不是：

> “模型说做完了，所以做完了。”

这和你之前那个 Goal JSON / expected result 的思路其实天然可以接起来。

------

# 十、这样设计，你最想要的几个收益才真正能同时成立

### Token

不是简单压 prompt。

而是减少：

```text
LLM round trips
×
history resend
```

尤其 EXECUTE 阶段直接下沉 runtime。

------

### 速度

任务从：

```text
Reason → Act → Reason → Act → Reason → Act
```

变成：

```text
Reason once
      ↓
Execute many
      ↓
Verify
```

------

### 幻觉

关键不是让模型：

> “think harder”。

而是减少模型参与那些本来不应该由语言模型判断的环节。

例如：

```text
file exists?
tests pass?
JSON schema valid?
hash equal?
HTTP status?
compiler pass?
```

全部 deterministic。

------

### 指令遵循

Goal 不再只存在 prompt。

而变成 runtime-owned:

```text
GoalSpec
StepSpec
Precondition
ExpectedOutcome
ActualOutcome
Validation
```

模型不能随便“忘掉”。

------

### “直觉”

这是我认为 Gungnir 很有潜力的地方。

所谓人的“直觉”并不是：

> 用更长的 CoT 飞快思考。

而更接近：

```text
pattern recognition
↓
直接选择动作
```

所以真正的 Agent fast thinking 应该是：

```text
low-cost classifier/router
↓
known loop policy
↓
execute
```

而不是：

```text
reasoning_effort = insane
```

------

# 十一、缓存问题也应该倒过来设计

这里不能简单宣传：

> “动态 loop = cache hit 更高。”

不一定。

DSH 自己已经注明：Code Mode、tool filter 或 prompt/schema 发生变化，都可能从首个变化 token 开始破坏 KV cache reuse。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md?utm_source=chatgpt.com))

所以 Gungnir 应该采用：

# **有限状态模板，而不是动态生成 prompt**

比如只有：

```text
reflex-v1
execute-v1
deliberate-v1
verify-v1
recover-v1
```

每个 mode 的：

```text
system prefix
tool schema
instructions
```

尽量稳定。

变化的信息放在尾部：

```text
state payload
goal
observation
```

于是 cache 结构类似：

```text
[stable REFLEX prefix] [state delta]
[stable EXECUTE prefix] [state delta]
[stable VERIFY prefix] [state delta]
```

而不是每一步重新生成一坨 system prompt。

------

# 十二、方案 B：维持原方案 —— Seam-only Gungnir

这就是你引用那段文字的路线。

完全不替换 agent-loop。

通过：

```text
agent/pre-step
agent/request
agent/request-error
tools/pre-execute
tools/post-execute
agent/turn-stopping
workflow
Code Mode
subagent
```

实现控制。

这条路线事实上很强。

DSH 的 `agent/pre-step` 本来就允许 reject / rewrite 本步输入；`agent/request-error` 可以决定 retry；`agent/turn-stopping` 可以通过 steering 阻止 turn 结束。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md?utm_source=chatgpt.com))

所以它能实现非常多东西。

优势非常明确：

```text
兼容性极高
开发成本低
跟随上游升级容易
事件语义天然正确
崩溃恢复简单
插件生态兼容
```

但它存在一个不可避免的天花板：

# **它只能影响 loop 的 decision，不能真正拥有 loop 的 topology。**

你最终会得到：

```text
default loop
   ↑
hook
   ↑
hook
   ↑
hook
   ↑
workflow
   ↑
state machine
   ↑
context controller
```

久而久之成为：

> **用越来越复杂的插件去模拟另一个 agent-loop。**

这就是典型的“second-system hiding inside middleware”。

------

# 十三、两条路线真正的区别

|                         | **A：Adaptive Loop Replacement** | **B：Seam Control Plane** |
| ----------------------- | -------------------------------- | ------------------------- |
| 改变模型                | ★★★★★                            | ★★★★★                     |
| tool batching           | ★★★★★                            | ★★★★★                     |
| deterministic verify    | ★★★★★                            | ★★★★★                     |
| suspend/wait            | ★★★★★                            | ★★★★                      |
| context projection      | ★★★★★                            | ★★★                       |
| branch search           | ★★★★★                            | ★★★                       |
| 自定义 step topology    | ★★★★★                            | ★                         |
| adaptive stop semantics | ★★★★★                            | ★★★                       |
| runtime-owned goal      | ★★★★★                            | ★★★★                      |
| 上游兼容性              | ★★★                              | ★★★★★                     |
| 实现难度                | ★★                               | ★★★★★                     |
| 可验证性初期            | ★★★                              | ★★★★★                     |
| 长期架构上限            | ★★★★★                            | ★★★                       |
| 真正形成产品护城河      | **★★★★★**                        | **★★**                    |

------

# 十四、我的最终判断

## **选 A。**

而且我现在比你引用的那段论述更确定。

因为经过检查 DSH 当前架构之后，那个方案实际上是在为了保护一个**并没有真正被威胁的东西**，牺牲你最核心的产品目标。

Append-only ledger 完全可以保留。

工具安全流水线完全可以保留。

LLM seam 可以保留。

Session persistence 可以保留。

Agent contract 可以保留。

你只替换：

# **driver。**

而 DSH 本来就专门把 driver 做成了可替换对象。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.zh.md?utm_source=chatgpt.com))

所以：

> **“为了 DSH 架构哲学而不换 agent-loop”其实可能恰恰误读了 DSH 架构哲学。**

DSH 真正的哲学不是：

> default loop 神圣不可动。

而是：

> **mechanism 通过稳定 contract 解耦，因此 implementation 可以替换。**

------

# 十五、但有一个非常重要的边界：不要做“物理热插拔 Loop”

这是我认为你现在最值得定死的一条 ADR。

不要：

```text
ReactLoopAgent
    ↓ unload
PlanningLoopAgent
    ↓ unload
ExecutionLoopAgent
    ↓ unload
VerificationLoopAgent
```

尤其不要在：

```text
open turn
open step
pending tool call
active AbortSignal
```

时这么搞。

因为默认 driver 确实拥有 agent 生命周期、turn/step 边界、工具调度和 teardown 等责任；这种实例级 hot swap 很容易引入 ownership 和半提交状态问题。([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md?utm_source=chatgpt.com))

正确的是：

```text
             AdaptiveLoopAgent
                    │
           stable for lifetime
                    │
        ┌───────────┴──────────┐
        ▼                      ▼
   Loop State              Strategy
   durable-ish             replaceable
        │
  ┌─────┼─────┬─────┬──────┐
  ▼     ▼     ▼     ▼      ▼
FAST   EXEC  THINK VERIFY RECOVER
```

也就是说：

> **替换一次 Agent Loop implementation；任务中切换的是 Loop Policy，而不是 Agent Loop 对象本身。**

这会是我给 Gungnir 定的核心架构原则。

------

# 十六、甚至 append-only ledger 反而应该成为你的优势

我会新增类似：

```text
loop/mode-selected
loop/transition
loop/budget-updated
loop/validation
loop/recovery-triggered
loop/context-projection
loop/branch-created
loop/branch-selected
```

这样的可观测事实。

于是一次任务以后可以重放成：

```text
Goal
 │
 ├─ REFLEX
 │     └─ confidence .42
 │
 ├─ DELIBERATE
 │     └─ plan created
 │
 ├─ EXECUTE
 │     └─ 17 tool calls / 4 parallel groups
 │
 ├─ VERIFY
 │     └─ failed: test_foo
 │
 ├─ RECOVER
 │     └─ fork seq=183
 │
 ├─ EXECUTE
 │
 └─ VERIFY
       └─ PASS
```

这反而比传统 ReAct：

```text
assistant thought
tool
assistant thought
tool
assistant thought
...
```

**更容易解释为什么 Agent 成功/失败。**

所以可信事件脊柱不是动态 loop 的敌人。

它应该成为：

# **Adaptive Loop 的飞行数据记录器。**

------

# 十七、最值得做的 48–72 小时实验

你的 SKILL 要求最后一定落到低成本、可逆验证实验。

不要一上来重写完整 DSH loop。

做一个：

## `AdaptiveLoop Spike v0`

只实现三种模式：

```text
FAST
EXECUTE
VERIFY
```

规则甚至先不要用 LLM router。

直接 deterministic：

```text
需要多工具连续执行
→ EXECUTE / Code Mode

存在确定性验收器
→ VERIFY

否则
→ FAST
```

然后拿同一批任务跑四组：

```text
DSH Standard
DSH Code/PTC
DSH Workflow
Gungnir AdaptiveLoop
```

**千万不要只跟 Standard 比。**

因为真正要证明的是：

> Gungnir 比 DSH 已经拥有的 Code Mode + Workflow 还能多创造多少价值。

至少记录：

```text
task success
input tokens
output tokens
LLM calls
tool calls
LLM round trips
wall-clock latency
cache hit
validation failures
instruction violations
loop repetitions
recovery count
```

我建议第一道继续/熔断门可以定成：

```text
Task success 不下降

且满足下面至少两项：

Input token      ↓ ≥20%
LLM round-trip   ↓ ≥25%
Latency          ↓ ≥15%
重复无效步骤      ↓ ≥30%
```

数字是**实验门槛建议，不是已经验证过的事实**。

如果连 Code/PTC baseline 都打不过：

> 暂停替换 loop，回退方案 B。

如果明显打赢：

> 立即推进真正的 AdaptiveLoop。

------

# 最后，把整个战略压缩成一句话

原 Gungnir 的思想是：

> **“我不碰发动机，只在所有接缝上聪明地控制它。”**

我现在建议你的 Gungnir 是：

> **“我保留 DSH 的底盘、仪表、黑匣子、安全系统和接口，但把固定变速箱换成一套自适应变速箱。”**

这才和你最开始想做的东西一致：

# **不是让 AI 每次都更努力地想。**

# **而是让系统知道什么时候根本不该想、什么时候应该直接干、什么时候批量干、什么时候验证、什么时候推翻思路，以及只有什么时候才值得真正深思。**

这条路线比单纯的“接缝控制插件”难很多，但如果做好，**它才有资格成为一个新的 Agent Runtime 层，而不是又一个 DSH optimization plugin。**