import { describe, expect, it } from 'vitest'
import {
  contractToSupplied,
  parseDispatchContract,
  replayEvidenceFrom,
  supplyCoverageOf,
  type DispatchContract,
} from '../src/contract.ts'

/** 全供给契约（健康演示形态）：api + 命令判据 + artifact 判据 + 沙箱外判据 + grounding + baselineRef。 */
function fullContract(): DispatchContract {
  return parseDispatchContract({
    taskId: 'demo-pipeline',
    dispatcher: 'demo',
    objective: '修复 exportPipeline：非法行不得导出且必须计数（node --test 全绿）。',
    acceptance: [
      {
        id: 'c1-suite',
        description: '测试套件 node --test 通过',
        verifierLevel: 1,
        command: 'node --test',
        expectedExitCode: 0,
        timeoutMs: 120000,
      },
      {
        id: 'c2-report',
        description: 'out/report.txt 存在且首行为表头',
        verifierLevel: 2,
        predicate: { kind: 'artifact', path: 'out/report.txt', mustExist: true, contains: 'id|name|amount|date' },
      },
      {
        id: 'c3-loss',
        description: '30% 丢包弱网下成功率 ≥ 99%（沙箱外判据）',
        verifierLevel: 1,
        command: 'node --test test/loss.test.js',
        observability: 'sandbox-external',
      },
    ],
    api: { module: 'src/pipeline.js', function: 'exportPipeline', template: 'pipeline-validation' },
    grounding: [{ output: 'src/pipeline.js', source: 'docs/FORMAT.md' }],
    baselineRef: { type: 'git', commit: 'abc123' },
    budget: { maxSeconds: 600 },
  })
}

describe('DispatchContract schema', () => {
  it('合法全供给契约通过解析', () => {
    const contract = fullContract()
    expect(contract.objective).toContain('exportPipeline')
    expect(contract.acceptance).toHaveLength(3)
    expect(contract.api?.template).toBe('pipeline-validation')
    expect(contract.baselineRef?.commit).toBe('abc123')
  })

  it('L1 判据缺 command → 拒收（schema 判别联合）', () => {
    const raw = {
      objective: 'x',
      acceptance: [{ id: 'c1', description: 'd', verifierLevel: 1, expectedExitCode: 0 }],
    }
    expect(() => parseDispatchContract(raw)).toThrow()
  })

  it('L2 判据缺 predicate → 拒收', () => {
    const raw = {
      objective: 'x',
      acceptance: [{ id: 'c1', description: 'd', verifierLevel: 2, command: 'node --test' }],
    }
    expect(() => parseDispatchContract(raw)).toThrow()
  })

  it('acceptance 空数组 → 拒收', () => {
    expect(() => parseDispatchContract({ objective: 'x', acceptance: [] })).toThrow()
  })

  it('重复 acceptance id → 拒收（superRefine）', () => {
    const raw = {
      objective: 'x',
      acceptance: [
        { id: 'c1', description: 'd', verifierLevel: 1, command: 'node --test' },
        { id: 'c1', description: 'd2', verifierLevel: 2, predicate: { kind: 'artifact', path: 'a.txt' } },
      ],
    }
    expect(() => parseDispatchContract(raw)).toThrow(/duplicate acceptance id/)
  })

  it('未知 api.template → 拒收（模板名必须存在于模板库）', () => {
    const raw = fullContract()
    const rawObject = JSON.parse(JSON.stringify(raw))
    rawObject.api.template = 'no-such-template'
    expect(() => parseDispatchContract(rawObject)).toThrow()
  })
})

describe('contractToSupplied 投影', () => {
  it('provable L1 → exit_code 控制臂判据 + replay evidence', () => {
    const supplied = contractToSupplied(fullContract())
    const c1 = supplied.criteria.find((criterion) => criterion.id === 'c1-suite')
    expect(c1?.verifierLevel).toBe(1)
    expect(c1?.predicate).toEqual({ kind: 'exit_code', command: 'node --test', expectedExitCode: 0, timeoutMs: 120000 })
    expect(supplied.replay?.evidence).toEqual([
      { id: 'c1-suite', command: 'node --test', expectedExitCode: 0, timeoutMs: 120000 },
    ])
    expect(supplied.replay?.buggyRef).toEqual({ type: 'git', commit: 'abc123' })
  })

  it('provable L2 → artifact 控制臂判据，不进 replay', () => {
    const supplied = contractToSupplied(fullContract())
    const c2 = supplied.criteria.find((criterion) => criterion.id === 'c2-report')
    expect(c2?.verifierLevel).toBe(2)
    expect(c2?.predicate).toEqual({ kind: 'artifact', path: 'out/report.txt', mustExist: true, contains: 'id|name|amount|date' })
    expect(supplied.replay?.evidence?.some((evidence) => evidence.id === 'c2-report')).toBe(false)
  })

  it('sandbox-external → unverifiableCriteria，不进控制臂判据', () => {
    const supplied = contractToSupplied(fullContract())
    expect(supplied.criteria.some((criterion) => criterion.id === 'c3-loss')).toBe(false)
    expect(supplied.unverifiableCriteria).toEqual([{ id: 'c3-loss', description: expect.stringContaining('沙箱外') }])
  })

  it('api / grounding 直传', () => {
    const supplied = contractToSupplied(fullContract())
    expect(supplied.api?.template).toBe('pipeline-validation')
    expect(supplied.grounding?.dependencies).toEqual([{ output: 'src/pipeline.js', source: 'docs/FORMAT.md' }])
  })

  it('无 baselineRef → replay 缺省；无 grounding → grounding 缺省', () => {
    const minimal = parseDispatchContract({
      objective: 'x',
      acceptance: [{ id: 'c1', description: 'd', verifierLevel: 2, predicate: { kind: 'artifact', path: 'a.txt' } }],
    })
    const supplied = contractToSupplied(minimal)
    expect(supplied.replay).toBeUndefined()
    expect(supplied.grounding).toBeUndefined()
    expect(supplied.unverifiableCriteria).toBeUndefined()
  })

  it('全部 sandbox-external → 控制臂判据为空', () => {
    const contract = parseDispatchContract({
      objective: 'x',
      acceptance: [{ id: 'c1', description: 'd', verifierLevel: 1, command: 'x', observability: 'sandbox-external' }],
    })
    const supplied = contractToSupplied(contract)
    expect(supplied.criteria).toHaveLength(0)
    expect(supplied.unverifiableCriteria).toHaveLength(1)
  })
})

describe('replayEvidenceFrom', () => {
  it('只取 provable L1 command 判据（sandbox-external 与 L2 不进）', () => {
    const evidence = replayEvidenceFrom(fullContract())
    expect(evidence.map((entry) => entry.id)).toEqual(['c1-suite'])
  })
})

describe('supplyCoverageOf 供给覆盖报告', () => {
  it('全供给契约 → 四药方全 applied', () => {
    const coverage = supplyCoverageOf(fullContract())
    expect(coverage.every((entry) => entry.status === 'applied')).toBe(true)
    expect(coverage.map((entry) => entry.medicine).sort()).toEqual(['M-A', 'M-B', 'M-C', 'M-D'])
  })

  it('健康 PASS 形态（无沙箱外判据）→ M-A/M-B/M-D applied，M-C not-applied 带原因', () => {
    const contract = fullContract()
    const raw = JSON.parse(JSON.stringify(contract)) as { acceptance: { id: string }[] }
    raw.acceptance = raw.acceptance.filter((criterion) => criterion.id !== 'c3-loss')
    const parsed = parseDispatchContract(raw)
    const coverage = supplyCoverageOf(parsed)
    const mc = coverage.find((entry) => entry.medicine === 'M-C')
    expect(mc?.status).toBe('not-applied')
    expect(mc?.reason).toContain('no sandbox-external')
    expect(coverage.filter((entry) => entry.status === 'applied').map((entry) => entry.medicine)).toEqual(['M-A', 'M-B', 'M-D'])
  })

  it('缺 baselineRef → M-B not-applied，原因如实（不假装 replay）', () => {
    const contract = fullContract()
    const raw = JSON.parse(JSON.stringify(contract))
    delete raw.baselineRef
    const coverage = supplyCoverageOf(parseDispatchContract(raw))
    const mb = coverage.find((entry) => entry.medicine === 'M-B')
    expect(mb?.status).toBe('not-applied')
    expect(mb?.reason).toContain('no baselineRef')
  })

  it('有 baselineRef 但无 command 判据 → M-B not-applied（无可 replay 的声称证据）', () => {
    const contract = parseDispatchContract({
      objective: 'x',
      acceptance: [{ id: 'c1', description: 'd', verifierLevel: 2, predicate: { kind: 'artifact', path: 'a.txt' } }],
      baselineRef: { type: 'git', commit: 'abc' },
    })
    const mb = supplyCoverageOf(contract).find((entry) => entry.medicine === 'M-B')
    expect(mb?.status).toBe('not-applied')
    expect(mb?.reason).toContain('no provable command-class')
  })

  it('缺 api / grounding → 各自 not-applied 带原因', () => {
    const contract = parseDispatchContract({
      objective: 'x',
      acceptance: [{ id: 'c1', description: 'd', verifierLevel: 1, command: 'node --test' }],
    })
    const coverage = supplyCoverageOf(contract)
    expect(coverage.find((entry) => entry.medicine === 'M-A')?.status).toBe('not-applied')
    expect(coverage.find((entry) => entry.medicine === 'M-D')?.status).toBe('not-applied')
  })
})
