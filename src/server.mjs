import { createProduct } from './product.mjs';
import { listen, readJson, reply } from './http.mjs';
export async function startProduct(options) {
  const product = await createProduct(options);
  const service = await listen(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://local');
      if (request.method === 'GET' && url.pathname === '/health') return reply(response, 200, { ok: true });
      if (request.method === 'GET' && url.pathname === '/state') {
        const param = url.searchParams.get('now');
        const now = param === null ? 0 : Number(param);
        if (!Number.isInteger(now) || now < 0) return reply(response, 422, { error: '业务时间无效' });
        return reply(response, 200, product.view(now));
      }
      if (request.method === 'POST' && url.pathname === '/collect') return reply(response, 200, await product.collect(await readJson(request)));
      if (request.method === 'POST' && url.pathname === '/confirm') return reply(response, 200, await product.confirm(await readJson(request)));
      if (request.method === 'POST' && url.pathname === '/refresh') return reply(response, 200, await product.refresh(await readJson(request)));
      reply(response, 404, { error: '路径不存在' });
    } catch (error) { reply(response, 422, { error: error.message }); }
  }, options.port ?? 0);
  return { ...service, product };
}
if (process.argv[1]?.endsWith('/server.mjs')) {
  const service = await startProduct({ sourceUrl: process.env.SOURCE_URL ?? 'http://127.0.0.1:4101', statePath: process.env.STATE_PATH ?? 'var/state.json', port: Number(process.env.PORT ?? 4100) });
  console.log(JSON.stringify({ 服务地址: service.url }));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await service.close(); process.exit(0); });
}
