export function assess(request, data, failures = []) {
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= (request.now ?? 0)) throw new Error('报价已失效');
  if (!Array.isArray(data.charges)) throw new Error('报价缺少费用依据');
  const required = data.charges.filter(item => item.required);
  if (!required.length && !failures.length) throw new Error('缺少必收费用');
  for (const item of required) {
    if (typeof item.kind !== 'string' || !item.kind) throw new Error('缺少必收费用');
    if (!Number.isSafeInteger(item.amount) || item.amount < 0) throw new Error('费用金额无效');
  }
  const kinds = new Set(required.map(item => item.kind));
  if (kinds.size !== required.length) throw new Error('同一费用重复声明');
  const total = required.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(total)) throw new Error('总价无法准确表示');
  const complete = !failures.some(failure => failure.required);
  return { total: complete ? total : null, complete };
}

function view(quote) {
  return { id: quote.id, inquiry: quote.inquiry, carrier: quote.carrier, requested: quote.requested, accepted: quote.accepted, differences: quote.differences, charges: quote.charges, failures: quote.failures, total: quote.total, revision: quote.revision, expiresAt: quote.expiresAt, status: quote.status, confirmations: quote.confirmations };
}

export function present(state, now = 0) {
  const candidates = []; const leads = [];
  for (const quote of Object.values(state.quotes)) {
    const inquiry = state.inquiries[quote.inquiry];
    if (!inquiry) continue;
    if (quote.generation !== inquiry.generation || quote.status === 'superseded') leads.push({ ...view(quote), status: 'superseded', reason: '询盘条件已变更，旧条件结果不再适用' });
    else if (quote.status === 'declined') leads.push({ ...view(quote), reason: '采购已拒绝该条件' });
    else if (quote.status === 'expired' || quote.expiresAt <= now) leads.push({ ...view(quote), status: 'expired', reason: '报价已到期' });
    else if (quote.status === 'incomplete') leads.push({ ...view(quote), reason: '附加费用领取失败，费用不完整，不能按零元比较' });
    else if (quote.status === 'pending') leads.push({ ...view(quote), reason: '承运商条件超出授权，待采购确认', pendingDifferences: quote.differences.filter(difference => !difference.authorized) });
    else candidates.push({ ...view(quote), basis: quote.status === 'confirmed' ? '采购确认' : quote.differences.length ? '授权内修正' : '标准报价', terms: quote.accepted });
  }
  candidates.sort((left, right) => left.total - right.total || left.id.localeCompare(right.id));
  leads.sort((left, right) => left.id.localeCompare(right.id));
  return { inquiries: Object.values(state.inquiries), quotes: candidates, leads, cheapest: candidates[0]?.id ?? null };
}
