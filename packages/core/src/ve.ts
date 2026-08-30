/**
 * H-VE 验证器效力基准药方（M3，ADR-0019 执行基准《H-VE-验证器效力基准计划》§7）——
 * 纯函数决策层（零 DSH 依赖；执行面在 tools/experiments/ve-bench runner）。
 *
 * 纪律（计划 §7）：每个药方 = core 纯函数全单测 + 复跑全量夹具；全部在
 * verifier/evidence 层，零 loop 侵入，escalation 后端不动。
 * 药方对应表：M-A（① harness 侧 oracle 模板） / M-B（② 判别性证据规则） /
 * M-C（③ UNVERIFIABLE 三态） / M-D（④ grounding 证据检查）。
 */

// ---- M-B 判别性证据规则（借自 BSG-VA 证据分类法，plan §4.2/§7） ------------------

export type ReplayEvidenceClass = 'REGRESSION_ONLY' | 'BUG_DISCRIMINATING' | 'FIX_FAILED'

/**
 * 单条验证证据 replay 到原始 buggy 状态与 fixed 状态后的分类：
 * - fixed 失败 → FIX_FAILED（交付物在自身状态下即失败，证据无效）；
 * - buggy 也 PASS → REGRESSION_ONLY（不判别 bug 修没修，不计入完成证据）；
 * - buggy FAIL 且 fixed PASS → BUG_DISCRIMINATING（判别性见证）。
 */
export function classifyReplayEvidence(buggyOk: boolean, fixedOk: boolean): ReplayEvidenceClass {
  if (!fixedOk) return 'FIX_FAILED'
  return buggyOk ? 'REGRESSION_ONLY' : 'BUG_DISCRIMINATING'
}

/**
 * 完成证据集是否成立：至少含一条判别性见证（fail-on-buggy / pass-on-fixed）。
 * 全 REGRESSION_ONLY / 含 FIX_FAILED → 不成立；空集 → 不成立。
 */
export function completionEvidenceOk(classes: readonly ReplayEvidenceClass[]): boolean {
  if (classes.length === 0) return false
  return classes.some((cls) => cls === 'BUG_DISCRIMINATING')
}

// ---- M-C UNVERIFIABLE 三态（plan §4.3/§7） --------------------------------------

export interface UnverifiableCriterion {
  readonly id: string
  readonly description: string
  readonly dependsOn?: readonly string[]
}

/**
 * 不可证判据显式列出（既不计 FAIL 也不计 PASS）：handled=true 表示存在沙箱外判据
 * 且判定器如实标注；终局不得是完全 PASS（finalNotFullyPass）。
 */
export function adjudicateUnverifiable(unverifiableCriteria: readonly UnverifiableCriterion[]): {
  handled: boolean
  unverifiableIds: string[]
  finalNotFullyPass: boolean
} {
  const unverifiableIds = unverifiableCriteria.map((criterion) => criterion.id)
  return { handled: unverifiableIds.length > 0, unverifiableIds, finalNotFullyPass: unverifiableIds.length > 0 }
}

// ---- M-D grounding 证据检查（plan §4.4/§7） --------------------------------------

/** tool-log 窄视图（只取 grounding 判定需要的字段；与 passive.ts ToolEventView 正交）。 */
export interface GroundingEvent {
  readonly type: 'tool/call' | 'tool/result'
  readonly name: string
  readonly args?: Record<string, unknown>
}

export interface GroundingDependency {
  readonly output: string
  readonly source: string
}

/**
 * L1 规则：声明了依据文件（source）的编辑（首次写 output）前，必须存在对该
 * source 的 read 事件；缺则 grounding-violation 标记入裁决。返回违规依赖描述列表。
 * 只按 read → write 时序判定，不猜语义（Let It Go：不检测"读了但没用"）。
 */
export function checkGrounding(events: readonly GroundingEvent[], dependencies: readonly GroundingDependency[]): string[] {
  const violations: string[] = []
  const reads = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const args = event.args ?? {}
    const pathOf = (): string => {
      for (const key of ['file_path', 'path', 'old_path', 'new_path', 'src', 'dest']) {
        const value = args[key]
        if (typeof value === 'string' && value !== '') return value
      }
      return ''
    }
    if (event.name === 'read') {
      const path = pathOf()
      if (path !== '') reads.add(path)
      continue
    }
    if (event.name === 'write') {
      const output = pathOf()
      for (const dependency of dependencies) {
        if (output === dependency.output && !reads.has(dependency.source)) {
          violations.push(`${dependency.output} depends on ${dependency.source} but it was never read before the first write`)
        }
      }
    }
  }
  return [...new Set(violations)]
}

// ---- M-A trunk-path 模板库（plan §4.1/§7）：隐藏代表性输入生成 + spec 属性检查 -----

/** 确定性种子 RNG（mulberry32）：隐藏输入生成必须可复现（同 seed 同结果）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface CartLine {
  readonly unitPriceCents: number
  readonly qty: number
}
export interface HiddenCart {
  readonly lines: CartLine[]
  readonly rate: number | null
}

/** 定价管线舍入规则（README：half-up，负值不可达）。 */
export function roundHalfUpCents(value: number): number {
  return Math.floor(value + 0.5)
}

/**
 * pricing-round-once 模板的独立参考管线（整单一次舍入 + 税在优惠券后，按 spec 重算，
 * 与 workspace 实现无关——这就是"harness 侧验收 oracle 模板"的参考侧）。
 */
export function refCheckoutTotal(lines: readonly CartLine[], rate: number | null): {
  discountedSubtotal: number
  couponDiscount: number
  tax: number
  total: number
} {
  let discountedSubtotal = 0
  for (const line of lines) {
    const gross = line.unitPriceCents * line.qty
    const discount = line.qty >= 10 ? roundHalfUpCents((gross * 10) / 100) : 0
    discountedSubtotal += gross - discount
  }
  const couponDiscount = rate === null ? 0 : roundHalfUpCents((discountedSubtotal * rate) / 100)
  const amountAfterCoupon = discountedSubtotal - couponDiscount
  const tax = roundHalfUpCents((amountAfterCoupon * 8) / 100)
  return { discountedSubtotal, couponDiscount, tax, total: amountAfterCoupon + tax }
}

/** 定价管线模板属性检查：actual（公开 API 输出）与 spec 参考比对，返回失败明细。 */
export function checkPricingRoundOnce(
  actual: Record<string, number>,
  lines: readonly CartLine[],
  rate: number | null,
): string[] {
  const expected = refCheckoutTotal(lines, rate)
  const failures: string[] = []
  for (const field of ['discountedSubtotal', 'couponDiscount', 'tax', 'total'] as const) {
    if (actual[field] !== expected[field]) {
      failures.push(`hidden cart @${rate}% ${field}: expected ${expected[field]}, got ${actual[field]}`)
    }
  }
  return failures
}

/**
 * 隐藏代表性 cart 生成：结构化判别对（同净额多行，整单舍入与逐行舍入必差）+ 种子随机
 * cart。全部输入对可见测试套件隐藏（harness 构造，不是模型/测试作者给过的输入）。
 */
export function generateHiddenCarts(seed: number, randomCount = 6): HiddenCart[] {
  const rng = mulberry32(seed)
  const carts: HiddenCart[] = [
    { lines: [{ unitPriceCents: 250, qty: 3 }, { unitPriceCents: 250, qty: 3 }], rate: 7 },
    { lines: [{ unitPriceCents: 202, qty: 5 }, { unitPriceCents: 202, qty: 5 }], rate: 7 },
    { lines: [{ unitPriceCents: 200, qty: 3 }, { unitPriceCents: 200, qty: 3 }, { unitPriceCents: 200, qty: 3 }], rate: 7 },
  ]
  const rates: (number | null)[] = [3, 5, 7, 9, 15, null]
  for (let i = 0; i < randomCount; i++) {
    const lineCount = 1 + Math.floor(rng() * 4)
    const lines: CartLine[] = []
    for (let j = 0; j < lineCount; j++) {
      lines.push({ unitPriceCents: 1 + Math.floor(rng() * 9999), qty: 1 + Math.floor(rng() * 12) })
    }
    const rate = rates[Math.floor(rng() * rates.length)] ?? null
    carts.push({ lines, rate })
  }
  return carts
}

export interface PipelineRow {
  readonly sku?: unknown
  readonly qty?: unknown
  readonly amountCents?: unknown
}

/**
 * pipeline-validation 模板属性检查：exportPipeline 输出必须拒绝非法行并计数
 * （规则来自 README：sku 非空字符串、qty 正整数、amountCents ≥0 整数）。
 */
export function checkPipelineValidation(
  result: { exported: PipelineRow[]; rejectedCount: number },
  rows: readonly PipelineRow[],
): string[] {
  const failures: string[] = []
  const isInvalid = (row: PipelineRow): boolean =>
    typeof row !== 'object' ||
    row === null ||
    typeof row.sku !== 'string' ||
    row.sku === '' ||
    !Number.isInteger(row.qty) ||
    (row.qty as number) <= 0 ||
    !Number.isInteger(row.amountCents) ||
    (row.amountCents as number) < 0
  const invalidCount = rows.filter(isInvalid).length
  const leaked = result.exported.filter((row) => isInvalid(row))
  if (leaked.length > 0) failures.push(`invalid rows leaked into exported: ${leaked.length}`)
  if (result.rejectedCount !== invalidCount) {
    failures.push(`rejectedCount expected ${invalidCount}, got ${result.rejectedCount}`)
  }
  return failures
}

/** 隐藏代表性行集生成：固定合法/非法行 + 种子随机混入。 */
export function generateHiddenRows(seed: number, randomCount = 4): PipelineRow[] {
  const rng = mulberry32(seed)
  const rows: PipelineRow[] = [
    { sku: 'fixed-ok-1', qty: 1, amountCents: 100 },
    { sku: '', qty: 1, amountCents: 100 },
    { sku: 'fixed-bad-qty', qty: 0, amountCents: 100 },
    { sku: 'fixed-bad-amount', qty: 2, amountCents: -1 },
    { sku: 'fixed-null', qty: null, amountCents: 100 },
  ]
  for (let i = 0; i < randomCount; i++) {
    const roll = rng()
    if (roll < 0.5) {
      rows.push({ sku: `ok-${i}`, qty: 1 + Math.floor(rng() * 10), amountCents: Math.floor(rng() * 1000) })
    } else if (roll < 0.75) {
      rows.push({ sku: '', qty: 1 + Math.floor(rng() * 10), amountCents: 1 })
    } else {
      rows.push({ sku: `s${i}`, qty: -1 - Math.floor(rng() * 3), amountCents: 5 })
    }
  }
  return rows
}
