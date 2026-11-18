export function prepare(state, input) {
  const inquiry = input.inquiry ?? 'I-1';
  if (input.pieces !== undefined && (!Number.isInteger(input.pieces) || input.pieces < 1)) throw new Error('件数须为正整数');
  const current = { inquiry, address: input.address ?? '青禾路6号', pieces: input.pieces ?? 3, services: input.services ?? ['delivery'], carrier: input.carrier ?? 'north' };
  state.inquiries[inquiry] = current;
  return current;
}
