import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from '../src/fixture.mjs';
import { createProduct } from '../src/product.mjs';
import { startProduct } from '../src/server.mjs';

const ADDRESS = '青禾路6号';
const REQUESTED = { address: ADDRESS, pieces: 3, services: ['delivery'] };

function rateBody(overrides = {}) {
  return { inquiry: 'I-1', carrier: 'north', quoteId: 'Q-1', revision: 1, accepted: { ...REQUESTED }, charges: [{ kind: 'linehaul', amount: 1200, required: true }], expiresAt: 9000, ...overrides };
}
function quoteBody(overrides = {}) {
  return { quoteId: 'Q-1', revision: 1, accepted: { ...REQUESTED }, charges: [{ kind: 'linehaul', amount: 1200, required: true }], expiresAt: 9000, ...overrides };
}
function scriptOf(routes) { return { routes }; }
function rateRoute(...responses) { return { method: 'POST', path: '/rate', responses: responses.map(body => ({ body })) }; }
function quoteRoute(...responses) { return { method: 'GET', path: '/quote/Q-1', responses: responses.map(body => ({ body })) }; }
function confirmationRoute(body = { confirmationId: 'CF1', accepted: true, seenQuoteRevision: 1 }, requireBody) { return { method: 'POST', path: '/confirmations', ...(requireBody ? { requireBody } : {}), responses: [{ body }] }; }

async function withFixture(script, operation) {
  const fixture = await startFixture(structuredClone(script));
  try { await operation(fixture); } finally { await fixture.close(); }
}

test('授权内的楼层补填自动继续并保留双方条件', async () => {
  await withFixture(scriptOf([rateRoute(rateBody({ accepted: { ...REQUESTED, floor: 4 } }))]), async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const result = await product.collect({ allow: [{ kind: 'floor' }] });
    assert.equal(result.cheapest, 'Q-1');
    assert.equal(result.leads.length, 0);
    const [quote] = result.quotes;
    assert.equal(quote.status, 'comparable');
    assert.equal(quote.basis, '授权内修正');
    assert.equal(quote.total, 1200);
    assert.deepEqual(quote.requested, REQUESTED);
    assert.equal(quote.accepted.floor, 4);
    assert.deepEqual(quote.differences, [{ kind: 'floor', field: 'floor', from: null, to: 4, authorized: true }]);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].body.allow, undefined);
  });
});

test('未授权的修正确认成为报价线索而不是候选', async () => {
  await withFixture(scriptOf([rateRoute(rateBody({ accepted: { ...REQUESTED, floor: 4 } }))]), async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const result = await product.collect({});
    assert.equal(result.cheapest, null);
    assert.equal(result.quotes.length, 0);
    assert.equal(result.leads.length, 1);
    assert.equal(result.leads[0].status, 'pending');
    assert.match(result.leads[0].reason, /待采购确认/);
    assert.deepEqual(result.leads[0].pendingDifferences, [{ kind: 'floor', field: 'floor', from: null, to: 4, authorized: false }]);
  });
});

test('地址拆分为干线末端且卸货点不变属授权内修正', async () => {
  const accepted = { pieces: 3, services: ['delivery'], segments: [{ leg: 'trunk', address: '港城枢纽' }, { leg: 'lastmile', address: ADDRESS }] };
  await withFixture(scriptOf([rateRoute(rateBody({ accepted }))]), async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const result = await product.collect({ allow: [{ kind: 'addressSplit' }] });
    assert.equal(result.cheapest, 'Q-1');
    const [quote] = result.quotes;
    assert.equal(quote.basis, '授权内修正');
    assert.deepEqual(quote.requested, REQUESTED);
    assert.equal(quote.differences.length, 1);
    assert.equal(quote.differences[0].kind, 'addressSplit');
    assert.equal(quote.differences[0].sameFinalAddress, true);
    assert.equal(quote.differences[0].authorized, true);
  });
});

test('拆分后卸货点变化必须等待采购确认，确认后按确认条件成交', async () => {
  const accepted = { pieces: 3, services: ['delivery'], segments: [{ leg: 'trunk', address: '港城枢纽' }, { leg: 'lastmile', address: '青禾路8号' }] };
  const script = scriptOf([rateRoute(rateBody({ accepted })), quoteRoute(quoteBody({ accepted })), confirmationRoute()]);
  await withFixture(script, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const first = await product.collect({ allow: [{ kind: 'addressSplit' }] });
    assert.equal(first.cheapest, null);
    assert.equal(first.leads[0].status, 'pending');
    assert.equal(first.leads[0].differences[0].sameFinalAddress, false);
    const decided = await product.confirm({ quoteId: 'Q-1', decision: 'accept' });
    assert.equal(decided.decision.confirmed, true);
    assert.equal(decided.cheapest, 'Q-1');
    const [quote] = decided.quotes;
    assert.equal(quote.basis, '采购确认');
    assert.equal(quote.terms.segments.at(-1).address, '青禾路8号');
    assert.equal(quote.confirmations.length, 1);
    assert.equal(fixture.calls.map(call => call.path).join(','), '/rate,/quote/Q-1,/confirmations');
  });
});

test('部分接受超出授权等待采购确认，确认时按来源重新计价成交', async () => {
  const script = scriptOf([
    rateRoute(rateBody({ accepted: { ...REQUESTED, pieces: 1 }, charges: [{ kind: 'linehaul', amount: 400, required: true }] })),
    quoteRoute(quoteBody({ revision: 2, accepted: { ...REQUESTED, pieces: 1 }, charges: [{ kind: 'linehaul', amount: 500, required: true }], expiresAt: 9500 })),
    confirmationRoute({ confirmationId: 'CF1', accepted: true, seenQuoteRevision: 2 }, { quoteId: 'Q-1', seenQuoteRevision: 2 }),
  ]);
  await withFixture(script, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const first = await product.collect({ allow: [{ kind: 'pieces', min: 2 }] });
    assert.equal(first.leads[0].status, 'pending');
    assert.deepEqual(first.leads[0].pendingDifferences, [{ kind: 'pieces', field: 'pieces', from: 3, to: 1, authorized: false }]);
    const decided = await product.confirm({ quoteId: 'Q-1', decision: 'accept' });
    assert.equal(decided.decision.confirmed, true);
    const [quote] = decided.quotes;
    assert.equal(quote.total, 500);
    assert.equal(quote.revision, 2);
    assert.equal(quote.expiresAt, 9500);
    assert.equal(quote.confirmations[0].revision, 2);
    assert.equal(fixture.calls[2].path, '/confirmations');
    assert.equal(fixture.calls[2].body.seenQuoteRevision, 2);
  });
});

test('采购确认期间到期的报价不拼入可比较结果', async () => {
  const script = scriptOf([
    rateRoute(
      rateBody({ accepted: { ...REQUESTED, pieces: 1 }, charges: [{ kind: 'linehaul', amount: 400, required: true }] }),
      rateBody({ carrier: 'east', quoteId: 'Q-2', charges: [{ kind: 'linehaul', amount: 300, required: true }], expiresAt: 100 }),
    ),
    quoteRoute(quoteBody({ accepted: { ...REQUESTED, pieces: 1 }, charges: [{ kind: 'linehaul', amount: 400, required: true }] })),
    confirmationRoute(),
  ]);
  await withFixture(script, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ carrier: 'north' });
    const second = await product.collect({ carrier: 'east' });
    assert.equal(second.cheapest, 'Q-2');
    const later = product.view(500);
    assert.equal(later.cheapest, null);
    assert.equal(later.quotes.length, 0);
    const decided = await product.confirm({ quoteId: 'Q-1', decision: 'accept', now: 500 });
    assert.equal(decided.decision.confirmed, true);
    assert.deepEqual(decided.quotes.map(quote => quote.id), ['Q-1']);
    assert.equal(decided.quotes[0].total, 400);
    assert.equal(decided.cheapest, 'Q-1');
    const expired = decided.leads.find(quote => quote.id === 'Q-2');
    assert.equal(expired.status, 'expired');
    assert.match(expired.reason, /到期/);
    assert.ok(!decided.quotes.some(quote => quote.total === 300));
  });
});

test('附加费用领取失败不当零元，修复后刷新完成费用', async () => {
  const charges = [{ kind: 'linehaul', amount: 1200, required: true }, { kind: 'upstairs', required: true, ref: '/surcharge/upstairs' }];
  const script = scriptOf([
    rateRoute(rateBody({ charges })),
    { method: 'GET', path: '/surcharge/upstairs', responses: [{ status: 503, body: { error: '来源维护' } }, { body: { kind: 'upstairs', amount: 80, required: true } }] },
    quoteRoute(quoteBody({ charges })),
  ]);
  await withFixture(script, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const first = await product.collect({});
    assert.equal(first.cheapest, null);
    assert.equal(first.quotes.length, 0);
    const lead = first.leads[0];
    assert.equal(lead.status, 'incomplete');
    assert.equal(lead.total, null);
    assert.match(lead.reason, /费用不完整/);
    assert.equal(lead.failures[0].kind, 'upstairs');
    const repaired = await product.refresh({ quoteId: 'Q-1' });
    assert.equal(repaired.decision.status, 'comparable');
    assert.equal(repaired.quotes[0].total, 1280);
    assert.equal(repaired.cheapest, 'Q-1');
    assert.deepEqual(fixture.calls.map(call => call.path), ['/rate', '/surcharge/upstairs', '/quote/Q-1', '/surcharge/upstairs']);
  });
});

test('采购修改件数后旧确认不套用到新询盘', async () => {
  const script = scriptOf([
    rateRoute(
      rateBody({ accepted: { ...REQUESTED, pieces: 2 }, charges: [{ kind: 'linehaul', amount: 800, required: true }] }),
      rateBody({ quoteId: 'Q-2', accepted: { ...REQUESTED, pieces: 5 }, charges: [{ kind: 'linehaul', amount: 2000, required: true }] }),
    ),
    quoteRoute(quoteBody({ accepted: { ...REQUESTED, pieces: 2 }, charges: [{ kind: 'linehaul', amount: 800, required: true }] })),
    confirmationRoute(),
  ]);
  await withFixture(script, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({});
    const confirmed = await product.confirm({ quoteId: 'Q-1', decision: 'accept' });
    assert.equal(confirmed.decision.confirmed, true);
    const changed = await product.collect({ pieces: 5 });
    assert.equal(changed.inquiries[0].generation, 2);
    assert.equal(changed.quotes.length, 1);
    assert.equal(changed.quotes[0].id, 'Q-2');
    assert.equal(changed.quotes[0].basis, '标准报价');
    assert.deepEqual(changed.quotes[0].confirmations, []);
    assert.equal(changed.quotes[0].requested.pieces, 5);
    const old = changed.leads.find(quote => quote.id === 'Q-1');
    assert.equal(old.status, 'superseded');
    assert.match(old.reason, /询盘条件已变更/);
  });
});

test('恢复未完询价不把旧确认当作新授权', async () => {
  const script = scriptOf([
    rateRoute(rateBody({ accepted: { ...REQUESTED, pieces: 2 }, charges: [{ kind: 'linehaul', amount: 800, required: true }] })),
    quoteRoute(
      quoteBody({ accepted: { ...REQUESTED, pieces: 2 }, charges: [{ kind: 'linehaul', amount: 800, required: true }] }),
      quoteBody({ revision: 2, accepted: { ...REQUESTED, pieces: 1 }, charges: [{ kind: 'linehaul', amount: 300, required: true }] }),
    ),
    confirmationRoute(),
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'inquiry-resume-'));
  try {
    await withFixture(script, async fixture => {
      const statePath = join(directory, 'state.json');
      const first = await createProduct({ sourceUrl: fixture.url, statePath });
      await first.collect({});
      const confirmed = await first.confirm({ quoteId: 'Q-1', decision: 'accept' });
      assert.equal(confirmed.decision.confirmed, true);
      const resumed = await createProduct({ sourceUrl: fixture.url, statePath });
      const restored = resumed.view();
      assert.equal(restored.quotes[0]?.status, 'confirmed');
      const refreshed = await resumed.refresh({ quoteId: 'Q-1' });
      assert.equal(refreshed.decision.status, 'pending');
      assert.equal(refreshed.cheapest, null);
      assert.equal(refreshed.quotes.length, 0);
      const lead = refreshed.leads.find(quote => quote.id === 'Q-1');
      assert.equal(lead.status, 'pending');
      assert.equal(lead.total, 300);
      assert.equal(lead.confirmations.length, 1);
      assert.deepEqual(lead.pendingDifferences, [{ kind: 'pieces', field: 'pieces', from: 3, to: 1, authorized: false }]);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('采购拒绝后报价不可再确认', async () => {
  await withFixture(scriptOf([rateRoute(rateBody({ accepted: { ...REQUESTED, floor: 4 } }))]), async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({});
    const declined = await product.confirm({ quoteId: 'Q-1', decision: 'reject' });
    assert.equal(declined.decision.confirmed, false);
    assert.equal(declined.leads[0].status, 'declined');
    assert.match(declined.leads[0].reason, /拒绝/);
    await assert.rejects(product.confirm({ quoteId: 'Q-1', decision: 'accept' }), /待确认/);
    const refreshed = await product.refresh({ quoteId: 'Q-1' });
    assert.equal(refreshed.decision.refreshed, false);
    assert.equal(fixture.calls.length, 1);
  });
});

test('卸货点直接变更不允许自动继续', async () => {
  await withFixture(scriptOf([rateRoute(rateBody({ accepted: { ...REQUESTED, address: '青禾路8号' } }))]), async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const result = await product.collect({ allow: [{ kind: 'address' }] });
    assert.equal(result.cheapest, null);
    assert.equal(result.leads[0].status, 'pending');
    assert.deepEqual(result.leads[0].pendingDifferences, [{ kind: 'address', field: 'address', from: ADDRESS, to: '青禾路8号', authorized: false }]);
  });
});

test('HTTP 办理交互式询价并按判定时间查询', async () => {
  const script = scriptOf([
    rateRoute(rateBody({ accepted: { ...REQUESTED, floor: 4 } })),
    quoteRoute(quoteBody({ accepted: { ...REQUESTED, floor: 4 } })),
    confirmationRoute(),
  ]);
  await withFixture(script, async fixture => {
    const service = await startProduct({ sourceUrl: fixture.url });
    try {
      const collected = await (await fetch(service.url + '/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
      assert.equal(collected.leads[0].status, 'pending');
      const decided = await (await fetch(service.url + '/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: 'Q-1', decision: 'accept' }) })).json();
      assert.equal(decided.decision.confirmed, true);
      const current = await (await fetch(service.url + '/state')).json();
      assert.equal(current.quotes[0].status, 'confirmed');
      assert.equal(current.cheapest, 'Q-1');
      const later = await (await fetch(service.url + '/state?now=99999')).json();
      assert.equal(later.quotes.length, 0);
      assert.match(later.leads[0].reason, /到期/);
      const missing = await fetch(service.url + '/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: 'Q-9', decision: 'accept' }) });
      assert.equal(missing.status, 422);
    } finally { await service.close(); }
  });
});
