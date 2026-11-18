export function accept(state, request, data) {
  if (!data.quoteId || !Array.isArray(data.charges)) throw new Error('报价缺少费用依据');
  const charges = data.charges.filter(item => item.required);
  if (charges.some(item => !Number.isSafeInteger(item.amount) || item.amount < 0)) throw new Error('费用金额无效');
  const quote = { id: data.quoteId, inquiry: request.inquiry, carrier: request.carrier, accepted: data.accepted, total: charges.reduce((sum, item) => sum + item.amount, 0), expiresAt: data.expiresAt };
  state.quotes[data.quoteId] = quote;
  return quote;
}
