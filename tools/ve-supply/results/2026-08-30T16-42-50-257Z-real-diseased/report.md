# 供给裁决报告 — demo-pipeline-healthy

- objective: 修复 exportPipeline（非法行不得导出且必须计数）+ 新建 formatReport（按 docs/FORMAT.md 格式），node --test 全绿。
- stackVerdict: **FAIL**
- session: not provided

## 供给覆盖报告（SupplyCoverage）

| 药方 | 状态 | 原因 |
|---|---|---|
| M-A | applied | — |
| M-B | applied | — |
| M-C | not-applied | no sandbox-external criteria declared |
| M-D | applied | — |

## 判据裁决

- criterion c1-suite (exit_code): FAIL — cmd:node --test (exit 1)
- criterion c2-report (artifact): PASS — path:src/report.js sha256:c5cb25ee7fe297a4

## 证据链（reasons）

- criterion c1-suite (exit_code): FAIL — cmd:node --test (exit 1)
- medicine: invalid rows leaked into exported: 7
- medicine: rejectedCount expected 7, got 0
- medicine: c1-suite: buggy=FAIL fixed=FAIL → FIX_FAILED

## 药方执行明细

- M-A: applied=true {"id":"M-A","applied":true,"ok":false,"failures":["invalid rows leaked into exported: 7","rejectedCount expected 7, got 0"]}
- M-B: applied=true {"id":"M-B","applied":true,"ok":false,"classes":["FIX_FAILED"],"details":["c1-suite: buggy=FAIL fixed=FAIL → FIX_FAILED"]}
- M-C: applied=false {"id":"M-C","applied":false,"handled":false,"unverifiableIds":[],"finalNotFullyPass":false}
- M-D: applied=true {"id":"M-D","applied":true,"violations":[]}

## 投影 supplied（概览）

- criteria: 2 条控制臂判据
- api: pipeline-validation
- replay: 1 条声称证据，buggyRef=cb39af47d08332f476bff579138c0463a538674b
- unverifiableCriteria: 0 条
- grounding: 1 条依赖声明
