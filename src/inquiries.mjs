import { fingerprint, validateConditions } from './terms.mjs';

function validateAllow(allow) {
  if (allow === undefined) return [];
  if (!Array.isArray(allow)) throw new Error('授权规则须为数组');
  return allow.map(rule => {
    if (!rule || typeof rule !== 'object' || typeof rule.kind !== 'string' || !rule.kind) throw new Error('授权规则无效');
    if (rule.kind === 'pieces') { const min = rule.min ?? 1; if (!Number.isInteger(min) || min < 1) throw new Error('授权规则无效'); return { kind: 'pieces', min }; }
    return { kind: rule.kind };
  });
}

function validateNow(now) {
  const value = now ?? 0;
  if (!Number.isInteger(value) || value < 0) throw new Error('业务时间无效');
  return value;
}

export function prepare(state, input) {
  const inquiry = input.inquiry ?? 'I-1';
  if (typeof inquiry !== 'string' || !inquiry) throw new Error('询盘标识无效');
  const carrier = input.carrier ?? 'north';
  if (typeof carrier !== 'string' || !carrier) throw new Error('承运商标识无效');
  const requested = validateConditions({ address: input.address ?? '青禾路6号', pieces: input.pieces ?? 3, services: input.services ?? ['delivery'], ...(input.floor === undefined ? {} : { floor: input.floor }) }, '询盘条件');
  const allow = validateAllow(input.allow);
  const now = validateNow(input.now);
  const existing = state.inquiries[inquiry];
  const generation = existing && fingerprint(existing.requested) === fingerprint(requested) ? existing.generation : (existing?.generation ?? 0) + 1;
  if (existing && generation !== existing.generation) for (const quote of Object.values(state.quotes)) if (quote.inquiry === inquiry && quote.generation !== generation) quote.status = 'superseded';
  state.inquiries[inquiry] = { id: inquiry, requested, allow, generation };
  return { inquiry, carrier, requested, allow, generation, now };
}

export function resolve(request, data) {
  if (data.inquiry !== request.inquiry || data.carrier !== request.carrier) throw new Error('报价不属于该询盘和承运商');
  return resolveQuote(data, data.quoteId);
}

export function resolveQuote(data, quoteId) {
  if (typeof quoteId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(quoteId)) throw new Error('报价标识无效');
  if (data.quoteId !== quoteId) throw new Error('来源返回了其他报价');
  const accepted = validateConditions(data.accepted, '接受条件');
  const revision = data.revision ?? 1;
  if (!Number.isInteger(revision) || revision < 1) throw new Error('报价版本无效');
  return { ...data, quoteId, accepted, revision };
}
