export async function resolveCharges(source, items) {
  if (!Array.isArray(items)) throw new Error('报价缺少费用依据');
  const charges = []; const failures = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('费用项目无效');
    const required = item.required === true;
    const kind = item.kind;
    if (item.ref === undefined) { charges.push({ kind, amount: item.amount, required }); continue; }
    if (typeof item.ref !== 'string' || !item.ref.startsWith('/')) { failures.push({ kind: kind ?? null, ref: item.ref ?? null, required, error: '费用领取路径无效' }); continue; }
    try {
      const received = await source.request({}, { method: 'GET', path: item.ref });
      if (!Number.isSafeInteger(received?.amount) || received.amount < 0) throw new Error('费用金额无效');
      if (kind !== undefined && received.kind !== undefined && received.kind !== kind) throw new Error('费用类别不符');
      const resolvedKind = kind ?? received.kind;
      if (typeof resolvedKind !== 'string' || !resolvedKind) throw new Error('费用类别缺失');
      charges.push({ kind: resolvedKind, amount: received.amount, required: required || received.required === true });
    } catch (error) { failures.push({ kind: kind ?? null, ref: item.ref, required, error: error.message }); }
  }
  return { charges, failures };
}

export function accept(state, request, data, evaluation) {
  const status = evaluation.failures.some(failure => failure.required) ? 'incomplete' : evaluation.differences.some(difference => !difference.authorized) ? 'pending' : 'comparable';
  const quote = { id: data.quoteId, inquiry: request.inquiry, generation: request.generation, carrier: request.carrier, requested: request.requested, accepted: data.accepted, differences: evaluation.differences, charges: evaluation.charges, total: evaluation.total, failures: evaluation.failures, revision: data.revision, expiresAt: data.expiresAt, status, confirmations: [] };
  state.quotes[quote.id] = quote;
  return quote;
}
