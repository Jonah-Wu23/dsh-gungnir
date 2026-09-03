<p align="center">
  <h1 align="center">gungnir-core (冈格尼尔核心)</h1>
</p>

<p align="center">
  <strong>Lock the goal. Adapt the loop. Prove the hit.</strong>
</p>

<p align="center">
  言出必行：证据裁决的领域核心，零依赖的纯函数库
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/gungnir-core"><img src="https://img.shields.io/npm/v/gungnir-core?color=cb3837&logo=npm" alt="npm package" /></a>
  <img src="https://img.shields.io/badge/platform-Node.js%20ESM-2F5D50" alt="Platform" />
  <a href="https://github.com/Jonah-Wu23/dsh-gungnir/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5B6C8F" alt="Apache License 2.0" /></a>
  <img src="https://img.shields.io/badge/dependencies-zero-2EA043" alt="Zero Dependencies" />
</p>

<p align="center">
  <a href="#30-秒了解">30 秒了解</a> ·
  <a href="#核心能力">核心能力</a> ·
  <a href="#数据流">数据流</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#参与项目">参与项目</a> ·
  <a href="#许可协议">许可协议</a>
</p>

## 30 秒了解

**gungnir-core 是 Gungnir 的领域函数库：目标契约、事件账本与裁决规则全部以零依赖的纯函数实现。** 任何运行时都能独立装载与测试，不依赖 DeepSeek Harness 或 cordis。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 目标契约 | GoalSpec 与事件、verdict 的类型化 schema，版本化目标规格 |
| 事件账本 | 追加式事件流与严格重放，畸形事件当场抛错，不做静默修复 |
| 裁决规则 | Reconciler 决策表，默认不升级，证据齐备才放行 |
| 验证器契约 | Verifier 接口与 VerifyContext 注入点，宿主按契约实现 |

## 数据流

```text
事件流（追加式） → fold（严格重放） → GungnirState → reconcile（决策表） → Decision
```

## 快速上手

```powershell
npm install gungnir-core
```

```ts
import { foldEvents, reconcile } from 'gungnir-core'

// 严格重放：畸形事件当场抛错，停在首个坏事件
const state = foldEvents(rawEvents)

// 裁决：依据轮末 verdict 决定下一步
const decision = reconcile(state, roundVerdicts)
```

## 参与项目

欢迎提交 Issue 与 Pull Request。提交修改前请在本地运行测试：

```powershell
pnpm -r typecheck
pnpm -r test
```

## 许可协议

本项目采用 [Apache License 2.0](https://github.com/Jonah-Wu23/dsh-gungnir/blob/main/LICENSE) 开源许可协议。版权所有 © 2026 Zonghe Wu。
