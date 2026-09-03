<p align="center">
  <h1 align="center">dsh-gungnir-loop (冈格尼尔回路)</h1>
</p>

<p align="center">
  <strong>Lock the goal. Adapt the loop. Prove the hit.</strong>
</p>

<p align="center">
  言出必行：DeepSeek Harness 的自适应 Agent Loop 运行时
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-gungnir-loop"><img src="https://img.shields.io/npm/v/dsh-gungnir-loop?color=cb3837&logo=npm" alt="npm package" /></a>
  <img src="https://img.shields.io/badge/platform-DSH%20%7C%20Node.js%20ESM-2F5D50" alt="Platform" />
  <a href="https://github.com/Jonah-Wu23/dsh-gungnir/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5B6C8F" alt="Apache License 2.0" /></a>
  <img src="https://img.shields.io/badge/adaptive--loop-rule--driven-E8B25C" alt="Adaptive Loop" />
</p>

<p align="center">
  <a href="#30-秒了解">30 秒了解</a> ·
  <a href="#核心特性">核心特性</a> ·
  <a href="#架构设计">架构设计</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#参与项目">参与项目</a> ·
  <a href="#许可协议">许可协议</a>
</p>

## 30 秒了解

**Gungnir Loop 是经 DSH 官方组合接缝整体替换默认 agent loop 的运行时驱动。** 每一轮走哪条路径由确定性决策表按证据裁决：正常回合走零打扰的快速路径，异常证据出现才升级到执行与验证路径。单回合切换预算防止策略振荡，会话可续跑。

Gungnir Loop 与 dsh-gungnir 插件配合，构成完整的控制面：

- **Adapt the loop（回路适配）**：经 DSH 官方组合接缝整体替换默认 loop，服务键保持兼容。
- **Prove the hit（证据裁决）**：路由只消费事件账本派生的结构化事实。
- **稳定优先（防振荡）**：切换受单回合预算约束，预算耗尽即保持当前模式。

## 核心特性

| 维度 | 默认 Agent Loop | Gungnir Loop |
| --- | --- | --- |
| 执行回路 | 内置单一回路 | 官方组合接缝整体替换 |
| 路径路由 | 固定执行策略 | 决策表在 FAST / EXECUTE / VERIFY 间选择 |
| 稳定性 | 策略固定 | 单回合切换预算，防振荡 |
| 事件语义 | 标准会话事件 | 同一套事件词汇，账本可冷重建 |

## 架构设计

```text
┌─────────────────────────────────────────────┐
│ Loop Router（决策表）                        │  按证据选择执行路径
├─────────────────────────────────────────────┤
│ Gungnir Adaptive Loop Driver                │  回合驱动、工具调度与验证指令
├─────────────────────────────────────────────┤
│ DSH Agent Contract / Session Log / Services │  基础平台：提供会话与工具交互能力
└─────────────────────────────────────────────┘
```

## 快速上手

**兼容性**：以 dsh v0.1.2-rc.1 为基线，peerDependencies 锁定实测版本。

### 安装

在 DeepSeek Harness 中执行安装命令：

```powershell
dsh plugin add dsh-gungnir-loop
```

### 装配

在 profile bundles 清单中禁用默认 `agent-loop` 行，插入本包行。服务键保持 `ctx.agentLoop`，headless、ACP 与子代理等消费方无需改动。

## 参与项目

欢迎提交 Issue 与 Pull Request。提交修改前请在本地运行测试：

```powershell
pnpm -r typecheck
pnpm -r test
```

## 许可协议

本项目采用 [Apache License 2.0](https://github.com/Jonah-Wu23/dsh-gungnir/blob/main/LICENSE) 开源许可协议。版权所有 © 2026 Zonghe Wu。
