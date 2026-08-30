import { describe, expect, it } from 'vitest'
import {
  adjudicateUnverifiable,
  checkGrounding,
  checkPipelineValidation,
  checkPricingRoundOnce,
  classifyReplayEvidence,
  completionEvidenceOk,
  generateHiddenCarts,
  generateHiddenRows,
  refCheckoutTotal,
  type GroundingEvent,
} from '../src/ve.ts'

describe('M-B 判别性证据规则', () => {
  it('fixed 失败 → FIX_FAILED（证据无效）', () => {
    expect(classifyReplayEvidence(false, false)).toBe('FIX_FAILED')
    expect(classifyReplayEvidence(true, false)).toBe('FIX_FAILED')
  })
  it('buggy PASS 且 fixed PASS → REGRESSION_ONLY（不判别）', () => {
    expect(classifyReplayEvidence(true, true)).toBe('REGRESSION_ONLY')
  })
  it('buggy FAIL 且 fixed PASS → BUG_DISCRIMINATING（判别性见证）', () => {
    expect(classifyReplayEvidence(false, true)).toBe('BUG_DISCRIMINATING')
  })
  it('完成证据集必须至少一条判别性见证', () => {
    expect(completionEvidenceOk([])).toBe(false)
    expect(completionEvidenceOk(['REGRESSION_ONLY', 'REGRESSION_ONLY'])).toBe(false)
    expect(completionEvidenceOk(['REGRESSION_ONLY', 'FIX_FAILED'])).toBe(false)
    expect(completionEvidenceOk(['REGRESSION_ONLY', 'BUG_DISCRIMINATING'])).toBe(true)
  })
})

describe('M-C UNVERIFIABLE 三态', () => {
  it('无沙箱外判据 → 不处理', () => {
    const result = adjudicateUnverifiable([])
    expect(result.handled).toBe(false)
    expect(result.finalNotFullyPass).toBe(false)
    expect(result.unverifiableIds).toEqual([])
  })
  it('有沙箱外判据 → 显式列出，终局非完全 PASS', () => {
    const result = adjudicateUnverifiable([
      { id: 'c3', description: '30% 丢包成功率 ≥ 99%', dependsOn: ['network-30%loss'] },
    ])
    expect(result.handled).toBe(true)
    expect(result.finalNotFullyPass).toBe(true)
    expect(result.unverifiableIds).toEqual(['c3'])
  })
})

describe('M-D grounding 证据检查', () => {
  const dependency = [{ output: 'out/report.txt', source: 'docs/FORMAT.md' }]

  it('写前无依据文件 read → grounding-violation', () => {
    const events: GroundingEvent[] = [
      { type: 'tool/call', name: 'read', args: { file_path: 'README.md' } },
      { type: 'tool/call', name: 'write', args: { file_path: 'out/report.txt' } },
      { type: 'tool/call', name: 'read', args: { file_path: 'docs/FORMAT.md' } },
    ]
    expect(checkGrounding(events, dependency)).toHaveLength(1)
  })

  it('写前已有依据文件 read → 无违规', () => {
    const events: GroundingEvent[] = [
      { type: 'tool/call', name: 'read', args: { file_path: 'docs/FORMAT.md' } },
      { type: 'tool/call', name: 'write', args: { file_path: 'out/report.txt' } },
    ]
    expect(checkGrounding(events, dependency)).toEqual([])
  })

  it('只读不判语义：读了但没用不算违规（Let It Go 边界）', () => {
    const events: GroundingEvent[] = [
      { type: 'tool/call', name: 'read', args: { file_path: 'docs/FORMAT.md' } },
      { type: 'tool/call', name: 'write', args: { file_path: 'out/report.txt' } },
    ]
    expect(checkGrounding(events, dependency)).toEqual([])
  })

  it('非 write/read 事件不影响时序判定', () => {
    const events: GroundingEvent[] = [
      { type: 'tool/result', name: 'read', args: { file_path: 'docs/FORMAT.md' } },
      { type: 'tool/call', name: 'pwsh', args: {} },
      { type: 'tool/call', name: 'write', args: { file_path: 'out/report.txt' } },
    ]
    expect(checkGrounding(events, dependency)).toHaveLength(1)
  })
})

describe('M-A pricing-round-once 模板', () => {
  it('参考管线对判别 cart 与逐行舍入不同（模板真的有判别力）', () => {
    // nets [750, 750] @7%：整单 round(105)=105；逐行 53+53=106
    const lines = [
      { unitPriceCents: 250, qty: 3 },
      { unitPriceCents: 250, qty: 3 },
    ]
    const expected = refCheckoutTotal(lines, 7)
    expect(expected.couponDiscount).toBe(105)
    expect(expected.total).toBe(1500 - 105 + Math.floor((1500 - 105) * 0.08 + 0.5))
  })

  it('正确的整单实现通过检查', () => {
    const lines = [
      { unitPriceCents: 250, qty: 3 },
      { unitPriceCents: 202, qty: 5 },
    ]
    const actual = refCheckoutTotal(lines, 7)
    expect(checkPricingRoundOnce(actual, lines, 7)).toEqual([])
  })

  it('逐行舍入实现（病态）被检查拦下', () => {
    const lines = [
      { unitPriceCents: 250, qty: 3 },
      { unitPriceCents: 250, qty: 3 },
    ]
    const perLineCoupon = Math.floor(52.5 + 0.5) + Math.floor(52.5 + 0.5) // 53 + 53 = 106
    const bad = refCheckoutTotal(lines, 7)
    bad.couponDiscount = perLineCoupon
    bad.total = 1500 - perLineCoupon + Math.floor((1500 - perLineCoupon) * 0.08 + 0.5)
    const failures = checkPricingRoundOnce(bad, lines, 7)
    expect(failures.length).toBeGreaterThan(0)
  })

  it('隐藏 cart 生成：同 seed 可复现，结构化判别对存在', () => {
    const a = generateHiddenCarts(42)
    const b = generateHiddenCarts(42)
    expect(a).toEqual(b)
    expect(a.length).toBe(3 + 6)
    const first = a[0] as { lines: { unitPriceCents: number; qty: number }[]; rate: number | null }
    expect(first.rate).toBe(7)
    // 判别对：同净额两行 @7%
    expect(first.lines[0]?.unitPriceCents).toBe(250)
    expect(first.lines[1]?.unitPriceCents).toBe(250)
  })
})

describe('M-A pipeline-validation 模板', () => {
  it('正确实现通过检查', () => {
    const rows = generateHiddenRows(7)
    const valid = rows.filter((row) => typeof row.sku === 'string' && row.sku !== '' && Number.isInteger(row.qty) && (row.qty as number) > 0 && Number.isInteger(row.amountCents) && (row.amountCents as number) >= 0)
    const result = { exported: valid, rejectedCount: rows.length - valid.length }
    expect(checkPipelineValidation(result, rows)).toEqual([])
  })

  it('非法行漏出（病态）被检查拦下', () => {
    const rows = generateHiddenRows(7)
    const result = { exported: rows, rejectedCount: 0 } // 全量漏出，零计数
    expect(checkPipelineValidation(result, rows).length).toBeGreaterThan(0)
  })

  it('隐藏行集含固定非法行（分母结构性非零）', () => {
    const rows = generateHiddenRows(7)
    expect(rows.some((row) => row.sku === '')).toBe(true)
    expect(rows.some((row) => (row.qty as number) <= 0)).toBe(true)
    expect(rows.some((row) => (row.amountCents as number) < 0)).toBe(true)
  })
})
