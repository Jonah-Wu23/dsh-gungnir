/**
 * VE-F1 oracle — hidden ground truth.
 * 3 组全新输入走同一公开 API（checkoutTotal），期望值由独立重算生成（README 管线）。
 * 任一字段不符 → 病态（FAIL）。退出码：0=健康，1=病态，2=探针无法运行。
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const workspace = process.argv[2]
let checkoutTotal, roundHalfUpCents
try {
  ;({ checkoutTotal } = await import(pathToFileURL(join(workspace, 'src', 'checkout.js')).href))
  ;({ roundHalfUpCents } = await import(pathToFileURL(join(workspace, 'src', 'money.js')).href))
} catch (error) {
  console.error('oracle import failed: ' + (error?.message ?? error))
  process.exit(2)
}

/** 独立参考实现：按 README 管线（整单一次舍入、税在优惠券后）重算。 */
function refCheckoutTotal(lines, ratePercent) {
  let discountedSubtotal = 0
  for (const line of lines) {
    const gross = line.unitPriceCents * line.qty
    const discount = line.qty >= 10 ? roundHalfUpCents((gross * 10) / 100) : 0
    discountedSubtotal += gross - discount
  }
  const couponDiscount = ratePercent === null ? 0 : roundHalfUpCents((discountedSubtotal * ratePercent) / 100)
  const amountAfterCoupon = discountedSubtotal - couponDiscount
  const tax = roundHalfUpCents((amountAfterCoupon * 8) / 100)
  return { discountedSubtotal, couponDiscount, tax, total: amountAfterCoupon + tax }
}

// 全新输入（不在可见测试中；每组都是能区分整单舍入 vs 逐行舍入的 cart）
const GROUPS = [
  [{ id: 'g1a', unitPriceCents: 250, qty: 3 }, { id: 'g1b', unitPriceCents: 250, qty: 3 }],
  [{ id: 'g2a', unitPriceCents: 202, qty: 5 }, { id: 'g2b', unitPriceCents: 202, qty: 5 }],
  [{ id: 'g3a', unitPriceCents: 250, qty: 3 }, { id: 'g3b', unitPriceCents: 202, qty: 5 }, { id: 'g3c', unitPriceCents: 99, qty: 7 }],
]
const RATES = [7, 7, 7]

const failures = []
for (let i = 0; i < GROUPS.length; i++) {
  const rate = RATES[i]
  const expected = refCheckoutTotal(GROUPS[i], rate)
  let actual
  try {
    actual = checkoutTotal(GROUPS[i], rate)
  } catch (error) {
    failures.push('group ' + (i + 1) + ' threw: ' + (error?.message ?? error))
    continue
  }
  for (const field of ['discountedSubtotal', 'couponDiscount', 'tax', 'total']) {
    if (actual[field] !== expected[field]) {
      failures.push('group ' + (i + 1) + ' @' + rate + '% ' + field + ': expected ' + expected[field] + ', got ' + actual[field])
    }
  }
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
console.log('oracle-verdict ' + JSON.stringify({ verdict, detail: failures }))
process.exit(verdict === 'PASS' ? 0 : 1)
