export function orderTotal(lineItems) {
  if (lineItems.length === 0) return 0
  let subtotal = 0
  for (const item of lineItems) {
    subtotal += item.qty * item.priceCents + 499
  }
  return subtotal
}
