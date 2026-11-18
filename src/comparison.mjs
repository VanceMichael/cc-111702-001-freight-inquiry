export function present(state) {
  const quotes = Object.values(state.quotes).filter(quote => state.inquiries[quote.inquiry]);
  quotes.sort((left, right) => left.total - right.total || left.id.localeCompare(right.id));
  return { inquiries: Object.values(state.inquiries), quotes, cheapest: quotes[0]?.id ?? null };
}

export function assess(state, request, data) {
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= (request.now ?? 0)) throw new Error('报价已失效');
  const required = data.charges.filter(item => item.required);
  if (!required.length || required.some(item => !item.kind)) throw new Error('缺少必收费用');
  const kinds = new Set(required.map(item => item.kind));
  if (kinds.size !== required.length) throw new Error('同一费用重复声明');
  const total = required.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(total)) throw new Error('总价无法准确表示');
  return { total, comparable: true, terms: data.accepted };
}
