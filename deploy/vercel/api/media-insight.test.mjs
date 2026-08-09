import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgAI/8x90jAAAAABJRU5ErkJggg==';
const validInsight = { summary: '适合一段松弛的城市漫游。', tags: ['松弛', '街区漫游', '咖啡停留'] };

const makeReq = ({ method = 'POST', body = '', headers = {} } = {}) => {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = '/api/media-insight';
  req.headers = { host: 'example.vercel.app', ...headers };
  return req;
};

const makeRes = () => ({
  headers: new Map(), statusCode: undefined, body: undefined,
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
  status(code) { this.statusCode = code; return this; },
  end(body) { this.body = body; },
});

const importAdapter = async () => import(`./media-insight.mjs?test=${Date.now()}-${Math.random()}`);

test('Vercel media adapter disables body parsing and returns the shared insight success response', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENHUB_API_KEY;
  process.env.TOKENHUB_API_KEY = 'server-only-test-key';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://tokenhub.tencentmaas.com/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer server-only-test-key');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validInsight) } }] }), { status: 200 });
  };
  try {
    const module = await importAdapter();
    assert.deepEqual(module.config, { api: { bodyParser: false } });
    const res = makeRes();
    await module.default(makeReq({ body: JSON.stringify({ imageDataUrl: tinyPng, description: '喜欢自然光' }), headers: { 'content-type': 'application/json' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const payload = JSON.parse(res.body);
    assert.equal(payload.meta.mode, 'live');
    assert.equal(payload.meta.provider, 'tokenhub');
    assert.deepEqual(payload.insight, validInsight);
    assert.doesNotMatch(res.body, /server-only-test-key/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENHUB_API_KEY;
    else process.env.TOKENHUB_API_KEY = originalKey;
  }
});

test('Vercel media adapter preserves shared method and oversized-body errors', async () => {
  const { default: handler } = await importAdapter();
  const methodRes = makeRes();
  await handler(makeReq({ method: 'GET' }), methodRes);
  assert.equal(methodRes.statusCode, 405);
  assert.equal(methodRes.headers.get('allow'), 'POST');
  assert.deepEqual(JSON.parse(methodRes.body).error, { code: 'method_not_allowed', message: '仅支持 POST 请求。' });

  const oversizedBody = JSON.stringify({ imageDataUrl: `data:image/png;base64,${'A'.repeat(Math.floor(1.5 * 1024 * 1024))}` });
  const oversizedRes = makeRes();
  await handler(makeReq({ body: oversizedBody, headers: { 'content-type': 'application/json' } }), oversizedRes);
  assert.equal(oversizedRes.statusCode, 413);
  assert.deepEqual(JSON.parse(oversizedRes.body).error, { code: 'body_too_large', message: '请求内容不能超过 1.5MB。' });
});
