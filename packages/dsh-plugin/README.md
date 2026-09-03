<p align="center">
  <h1 align="center">dsh-gungnir (冈格尼尔)</h1>
</p>

<p align="center">
  <strong>Lock the goal. Adapt the loop. Prove the hit.</strong>
</p>

<p align="center">
  言出必行：DeepSeek Harness 的证据驱动目标校验插件
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-gungnir"><img src="https://img.shields.io/npm/v/dsh-gungnir?color=cb3837&logo=npm" alt="npm package" /></a>
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
  <a href="#参与项目">参与项目</a> ·
  <a href="#许可协议">许可协议</a>
</p>

## 30 秒了解

**Gungnir 是 DeepSeek Harness 的证据驱动目标校验插件。** 目标经 `/ultragoal` 锁定为版本化契约，执行过程中的工具结果自动落入追加式证据账本；模型宣称完成时，退出码、工件与 LLM 评审三级验证器对照证据裁决，证据齐备才放行。

Gungnir 为大语言模型智能体提供面向任务结果的控制面能力：

- **Lock the goal（目标锁定）**：建立版本化目标契约，明确预期交付物和检验标准。
- **Prove the hit（证据裁决）**：模型输出只是待检验的声明，测试退出码与文件状态等环境证据才有裁决权。
- **静默守护与最小介入**：正常执行路径保持静默，只有观测到确定性证据冲突时才注入面向任务的明确反馈。

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

| 评测场景 | 具体用例 | 原生执行 (E0) | Gungnir 控制面 (E2) |
| --- | --- | --- | --- |
| 虚假完成拦截 | CLI 任务重试场景 | 0% (0/2) | **100% (2/2)** |
| 语义缺陷修复 | 状态重入场景 (Ledgerd) | 0% (0/2) | **100% (2/2)** |
| 验证错配修复 | 消息中继场景 (RelayPump) | 50% (1/2) | **100% (2/2)** |
| 标准开发任务 | 常规开发基准 (H1) | 100% (6/6) | **100% (6/6)** |

| 模型类型 | 虚假完成拦截率 | 语义缺陷修复率 | 标准任务通行率 |
| --- | --- | --- | --- |
| DeepSeek 系列 | 100% | 100% | 100% |
| GPT 系列 | 100% | 100% | 100% |
| GLM 系列 | 100% | 100% | 100% |

| 评测指标 | 原生执行 | Gungnir 控制面 | 控制面开销增量 |
| --- | --- | --- | --- |
| 中位 Token 消耗 | 24,151 | 26,025 | **+7.8%** |
| 中位模型交互轮次 | 12.0 轮 | 12.0 轮 | **0 轮** |
| 任务执行超时率 | 3.7% | 0.0% | **-3.7%** |

## 快速上手

**兼容性**：插件以 dsh v0.1.2-rc.1 为基线，peerDependencies 锁定实测版本。

### 安装

在 DeepSeek Harness 中执行安装命令：

```powershell
dsh plugin add dsh-gungnir
```

### 配置

插件装载后自动注册 `/ultragoal` 与 `/gungnir` 命令及模型侧工具。需要调整时，在配置文件中覆盖插件参数：

```yaml
plugins:
  - name: dsh-gungnir
    config:
      maxGoalRounds: 64
```

常用配置项：`maxGoalRounds`（目标轮次上限）、`rubricProvider` / `rubricModel`（LLM 评审模型）、`passive`（被动观察形态）。

## 参与项目

欢迎提交 Issue 与 Pull Request。提交修改前请在本地运行测试：

```powershell
pnpm -r typecheck
pnpm -r test
```

## 许可协议

本项目采用 [Apache License 2.0](LICENSE) 开源许可协议。版权所有 © 2026 Zonghe Wu。
