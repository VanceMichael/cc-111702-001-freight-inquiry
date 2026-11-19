import { readFile } from 'node:fs/promises';
import { Store } from './store.mjs';
import { Source } from './source.mjs';
import { prepare, resolve, resolveQuote } from './inquiries.mjs';
import { resolveCharges, accept } from './charges.mjs';
import { present, assess } from './comparison.mjs';
import { classify, differentiate, fingerprint } from './terms.mjs';

export async function createProduct({ sourceUrl, statePath = null }) {
  const config = JSON.parse(await readFile(new URL('./domain.json', import.meta.url), 'utf8'));
  const store = new Store(config.initial, statePath); await store.open();
  const source = new Source(sourceUrl, config.route);
  const quoteRoute = config.quoteRoute ?? { method: 'GET', path: '/quote/' };
  const confirmationRoute = config.confirmationRoute ?? { method: 'POST', path: '/confirmations' };

  async function evaluate(request, data) {
    const resolved = await resolveCharges(source, data.charges);
    const decision = assess(request, { ...data, charges: resolved.charges }, resolved.failures);
    const differences = classify(differentiate(request.requested, data.accepted), request.allow);
    return { charges: resolved.charges, failures: resolved.failures, total: decision.total, complete: decision.complete, differences };
  }

  function readQuote(quoteId) { return source.request({}, { method: quoteRoute.method, path: `${quoteRoute.path}${quoteId}` }); }

  function nowOf(input) { const now = input.now ?? 0; if (!Number.isInteger(now) || now < 0) throw new Error('业务时间无效'); return now; }

  function apply(quote, data, evaluation) {
    quote.accepted = data.accepted; quote.charges = evaluation.charges; quote.failures = evaluation.failures; quote.total = evaluation.total; quote.revision = data.revision; quote.expiresAt = data.expiresAt; quote.differences = evaluation.differences;
  }

  return {
    async collect(input = {}) {
      return store.update(async state => {
        const request = prepare(state, input);
        const response = await source.request({ inquiry: request.inquiry, carrier: request.carrier, ...request.requested });
        const data = resolve(request, response);
        const evaluation = await evaluate(request, data);
        accept(state, request, data, evaluation);
        return present(state, request.now);
      });
    },
    async confirm(input = {}) {
      return store.update(async state => {
        const quote = state.quotes[input.quoteId];
        if (!quote) throw new Error('报价不存在');
        const now = nowOf(input);
        const inquiry = state.inquiries[quote.inquiry];
        if (input.decision === 'reject') {
          if (quote.status !== 'pending') throw new Error('该报价不在待确认状态');
          quote.status = 'declined';
          return { ...present(state, now), decision: { quoteId: quote.id, confirmed: false, reason: '采购已拒绝' } };
        }
        if (input.decision !== 'accept') throw new Error('确认决定无效');
        if (quote.status !== 'pending') throw new Error('该报价不在待确认状态');
        if (!inquiry || quote.generation !== inquiry.generation) throw new Error('询盘条件已变更，旧报价不能确认');
        const seenTerms = fingerprint(quote.accepted);
        const data = resolveQuote(await readQuote(quote.id), quote.id);
        if (data.expiresAt <= now) { quote.status = 'expired'; quote.expiresAt = data.expiresAt; quote.revision = data.revision; return { ...present(state, now), decision: { quoteId: quote.id, confirmed: false, reason: '报价已到期' } }; }
        const request = { inquiry: quote.inquiry, carrier: quote.carrier, requested: inquiry.requested, allow: inquiry.allow, generation: inquiry.generation, now };
        const evaluation = await evaluate(request, data);
        apply(quote, data, evaluation);
        if (!evaluation.complete) { quote.status = 'incomplete'; return { ...present(state, now), decision: { quoteId: quote.id, confirmed: false, reason: '附加费用领取失败，费用不完整' } }; }
        if (fingerprint(data.accepted) !== seenTerms) return { ...present(state, now), decision: { quoteId: quote.id, confirmed: false, reason: '来源条件已变化，需采购再次确认' } };
        const confirmation = await source.request({ inquiry: quote.inquiry, quoteId: quote.id, seenQuoteRevision: data.revision, accepted: true }, confirmationRoute);
        if (!confirmation || confirmation.accepted !== true || typeof confirmation.confirmationId !== 'string') throw new Error('来源未接纳确认');
        if (confirmation.seenQuoteRevision !== undefined && confirmation.seenQuoteRevision !== data.revision) throw new Error('来源确认的报价版本不符');
        quote.confirmations.push({ id: confirmation.confirmationId, revision: data.revision, terms: seenTerms, at: now });
        quote.status = 'confirmed';
        return { ...present(state, now), decision: { quoteId: quote.id, confirmed: true } };
      });
    },
    async refresh(input = {}) {
      return store.update(async state => {
        const quote = state.quotes[input.quoteId];
        if (!quote) throw new Error('报价不存在');
        const now = nowOf(input);
        const inquiry = state.inquiries[quote.inquiry];
        if (!inquiry || quote.generation !== inquiry.generation || quote.status === 'superseded') return { ...present(state, now), decision: { quoteId: quote.id, refreshed: false, reason: '询盘条件已变更' } };
        if (quote.status === 'declined') return { ...present(state, now), decision: { quoteId: quote.id, refreshed: false, reason: '采购已拒绝' } };
        const data = resolveQuote(await readQuote(quote.id), quote.id);
        if (data.expiresAt <= now) { quote.status = 'expired'; quote.expiresAt = data.expiresAt; quote.revision = data.revision; return { ...present(state, now), decision: { quoteId: quote.id, refreshed: true, status: quote.status } }; }
        const request = { inquiry: quote.inquiry, carrier: quote.carrier, requested: inquiry.requested, allow: inquiry.allow, generation: inquiry.generation, now };
        const evaluation = await evaluate(request, data);
        apply(quote, data, evaluation);
        const terms = fingerprint(data.accepted);
        if (!evaluation.complete) quote.status = 'incomplete';
        else if (quote.confirmations.some(record => record.revision === data.revision && record.terms === terms)) quote.status = 'confirmed';
        else if (evaluation.differences.some(difference => !difference.authorized)) quote.status = 'pending';
        else quote.status = 'comparable';
        return { ...present(state, now), decision: { quoteId: quote.id, refreshed: true, status: quote.status } };
      });
    },
    view(now = 0) { return present(store.snapshot(), now); },
  };
}
