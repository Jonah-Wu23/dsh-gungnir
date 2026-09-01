<p align="center">
  <h1 align="center">Gungnir (冈格尼尔)</h1>
</p>

<p align="center">
  <strong>Lock the goal. Adapt the loop. Prove the hit.</strong>
</p>

<p align="center">
  言出必行：DeepSeek Harness 的证据导引型控制面插件
</p>

<p align="center">
  <a href="https://github.com/Jonah-Wu23/dsh-gungnir/releases"><img src="https://img.shields.io/badge/version-v0.1.0-blue" alt="Version 0.1.0" /></a>
  <img src="https://img.shields.io/badge/platform-DSH%20%7C%20Node.js%20ESM-2F5D50" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5B6C8F" alt="Apache License 2.0" /></a>
  <img src="https://img.shields.io/badge/control--plane-evidence--guided-E8B25C" alt="Control Plane" />
</p>

<p align="center">
  <a href="#30-秒了解">30 秒了解</a> ·
  <a href="#核心特性">核心特性</a> ·
  <a href="#架构设计">架构设计</a> ·
  <a href="#实验评测">实验评测</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="PHILOSOPHY.md">设计哲学</a> ·
  <a href="LICENSE">许可协议</a>
</p>

## 30 秒了解

**首个面向 DeepSeek Harness、根据运行时证据在单次任务执行过程中动态切换 Agent Loop Strategy 的自适应 Loop 插件。基于环境证据链裁决任务完成度，在保证正常执行流畅的同时，精准拦截虚假完成与逻辑缺陷。**

Gungnir 为大语言模型智能体提供面向任务结果的控制面能力：

- **Lock the goal（目标锁定）**：建立版本化目标契约，维护明确的预期交付物和检验标准。
- **Adapt the loop（回路适配）**：作为 DSH 官方扩展，提供对智能体执行回路的平滑替换与策略调度。
- **Prove the hit（证据裁决）**：将模型输出视为待检验的主张，通过测试退出码与文件状态等环境证据裁决成败。
- **静默守护与最小介入**：正常执行路径下保持静默，只有在观测到确定性证据冲突时才注入面向任务的明确反馈。

## 核心特性

| 维度 | 原生智能体执行 | Gungnir 控制面 |
| --- | --- | --- |
| 完成判定 | 依赖模型自我宣称 | 依据环境证据与退出码客观裁决 |
| 假完成拦截 | 容易放行未完成的任务 | 运行时拦截虚假完成并要求修正 |
| 正常任务开销 | 基础开销 | 保持静默，Token 额外开销仅 +7.8% |
| 控制面额外交互 | 无 | 正常路径零额外模型往返 |

## 架构设计

Gungnir 采用分层解耦的插件化架构，全面适配 DeepSeek Harness 生态：

```text
┌─────────────────────────────────────────────┐
│ Gungnir Goal Contract                       │  目标锁定：定义任务交付物与验证规则
├─────────────────────────────────────────────┤
│ Gungnir Adaptive Loop Runtime               │  回路适配：调度执行回路与策略
├─────────────────────────────────────────────┤
│ Gungnir Evidence / Verifier / Reconciler    │  证据裁决：收集环境事实，静默验证并按需介入
├─────────────────────────────────────────────┤
│ DSH Agent Contract / Session Log / Services │  基础平台：提供会话与工具交互能力
└─────────────────────────────────────────────┘
```

### 控制流程

1. **环境监听**：在智能体调用工具的过程中，被动收集命令退出码与生成文件状态。
2. **契约校验**：当智能体发出完成任务的声明时，系统基于已捕获的环境证据执行确定性验证。
3. **精准反馈**：若验证通过，系统保持静默放行；若存在未满足的检验条件，系统注入简明的客观事实反馈，引导模型完成修复。

## 实验评测

Gungnir 建立了标准化的评测基准，并在 54 组真实环境运行中完成了多模型对比实验。

### 实验设计与对照设置

评测设置了三个对比对照组：

- **原生执行 (E0)**：使用 DSH 默认执行回路，无控制面接入。
- **被动监听 (E3)**：仅收集工具事件，不执行探针升级。
- **Gungnir 控制面 (E2)**：包含完整的事件收集与运行时探针验证。

评测用例涵盖三类典型场景：

- **虚假完成场景 (T3)**：模型在未满足验证条件时提前声明完成。
- **复杂语义缺陷场景 (T1/T2)**：涉及状态重入与消息投递等深层逻辑问题。
- **标准开发任务场景 (H1)**：覆盖常规功能实现与测试编写。

### 场景拦截与修复评测

| 评测场景 | 具体用例 | 原生执行 (E0) | 被动监听 (E3) | Gungnir 控制面 (E2) |
| --- | --- | --- | --- | --- |
| 虚假完成拦截 | CLI 任务重试场景 | 0% (0/2) | 50% (1/2) | **100% (2/2)** |
| 语义缺陷修复 | 状态重入场景 (Ledgerd) | 0% (0/2) | 50% (1/2) | **100% (2/2)** |
| 验证错配修复 | 消息中继场景 (RelayPump) | 50% (1/2) | 50% (1/2) | **100% (2/2)** |
| 标准开发任务 | 常规开发基准 (H1) | 100% (6/6) | 100% (6/6) | **100% (6/6)** |

### 多模型评测表现

| 模型类型 | 虚假完成拦截率 | 语义缺陷修复率 | 标准任务通行率 |
| --- | --- | --- | --- |
| DeepSeek 系列 | 100% | 100% | 100% |
| GPT 系列 | 100% | 100% | 100% |
| GLM 系列 | 100% | 100% | 100% |

### 控制面性能开销

| 评测指标 | 原生执行 | Gungnir 控制面 | 控制面开销增量 |
| --- | --- | --- | --- |
| **中位 Token 消耗** | 24,151 | 26,025 | **+7.8%** |
| **中位模型交互轮次** | 12.0 轮 | 12.0 轮 | **0 轮** |
| **任务执行超时率** | 3.7% | 0.0% | **-3.7%** |

## 快速上手

**兼容性**：插件基于 dsh v0.1.2-alpha.1 开发，不兼容 dsh v0.1.1-rc2。

### 安装

在 DeepSeek Harness 工作区中执行安装命令：

```powershell
pnpm add dsh-gungnir
```

### 配置插件

在 DeepSeek Harness 配置文件中注册 Gungnir 插件：

```yaml
plugins:
  - name: dsh-gungnir
    config:
      passive: true
      escalation: true
```

启动 DSH 后，Gungnir 会自动在会话生命周期中监听执行事件，并在任务收尾阶段执行事实验证。

## 仓库结构

| 目录路径 | 主要功能 |
| --- | --- |
| `packages/core/` | 零依赖的领域纯函数库，包含目标契约与证据验证算法。 |
| `packages/dsh-plugin/` | DSH 插件适配层，实现事件监听与最小必要反馈注入。 |
| `packages/agent-loop/` | 自适应回路运行时驱动，提供执行回路替换能力。 |
| `tools/experiments/` | 真实多模型实验基准套件与评估分析脚本。 |
| `tools/destruction/` | 破坏性集成测试与鲁棒性验证用例。 |
| `docs/` | 架构决策记录与阶段测试报告。 |

## 参与项目

欢迎提交 Issue 与 Pull Request。提交修改前请在本地运行测试：

```powershell
pnpm -r typecheck
pnpm -r test
```

## 许可协议

本项目采用 [Apache License 2.0](LICENSE) 开源许可协议。版权所有 © 2026 Zonghe Wu。
