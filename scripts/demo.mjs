import { readFile } from 'node:fs/promises';
import { startFixture } from '../src/fixture.mjs';
import { createProduct } from '../src/product.mjs';
const standard = await startFixture(JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8')));
try {
  const product = await createProduct({ sourceUrl: standard.url });
  console.log('本地来源已就绪，办理一次正常业务');
  console.log(JSON.stringify(await product.collect({}), null, 2));
  console.log('来源实际请求'); console.log(JSON.stringify(standard.calls, null, 2));
} finally { await standard.close(); }
const counter = { pieces: 3, services: ['delivery'], floor: 2, segments: [{ leg: 'trunk', address: '港城枢纽' }, { leg: 'lastmile', address: '青禾路6号' }] };
const interactiveScript = {
  routes: [
    { method: 'POST', path: '/rate', responses: [{ body: { inquiry: 'I-1', carrier: 'north', quoteId: 'Q-1', revision: 1, accepted: counter, charges: [{ kind: 'linehaul', amount: 1200, required: true }], expiresAt: 9000 } }] },
    { method: 'GET', path: '/quote/Q-1', responses: [{ body: { quoteId: 'Q-1', revision: 2, accepted: counter, charges: [{ kind: 'linehaul', amount: 1250, required: true }], expiresAt: 9500 } }] },
    { method: 'POST', path: '/confirmations', responses: [{ body: { confirmationId: 'CF1', accepted: true, seenQuoteRevision: 2 } }] },
  ],
};
const interactive = await startFixture(interactiveScript);
try {
  const product = await createProduct({ sourceUrl: interactive.url });
  console.log('承运商提出地址拆分与楼层补填，未授权时先成为待确认线索');
  console.log(JSON.stringify(await product.collect({}), null, 2));
  console.log('采购确认后来源重新计价，按确认时版本与价格成交');
  console.log(JSON.stringify(await product.confirm({ quoteId: 'Q-1', decision: 'accept' }), null, 2));
  console.log('来源实际请求'); console.log(JSON.stringify(interactive.calls, null, 2));
} finally { await interactive.close(); }
