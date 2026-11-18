export function prepare(state, input) {
  const inquiry = input.inquiry ?? 'I-1';
  if (input.pieces !== undefined && (!Number.isInteger(input.pieces) || input.pieces < 1)) throw new Error('件数须为正整数');
  const current = { inquiry, address: input.address ?? '青禾路6号', pieces: input.pieces ?? 3, services: input.services ?? ['delivery'], carrier: input.carrier ?? 'north' };
  state.inquiries[inquiry] = current;
  return current;
}

export function resolve(state, request, data) {
  if (data.inquiry !== request.inquiry || data.carrier !== request.carrier) throw new Error('报价不属于该询盘和承运商');
  if (!data.accepted || data.accepted.address !== request.address || data.accepted.pieces !== request.pieces) throw new Error('标准报价条件与询盘不符');
  const expected = [...request.services].sort(); const actual = [...(data.accepted.services ?? [])].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('标准报价服务不符');
  return { ...data, accepted: { ...data.accepted, services: actual } };
}
