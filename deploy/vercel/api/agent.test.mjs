import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

const validProfile = {
  summary: '想要一段安静的海边短途休息。',
  emotions: [{ label: '安静', score: 91 }, { label: '松弛', score: 86 }, { label: '海风', score: 80 }, { label: '独处', score: 76 }],
  environments: ['海边'], pace: '慢速', socialDensity: '独处为主', climate: '偏凉', constraints: ['3 天'],
};

const makeReq = ({ method = 'POST', body = '', headers = {} } = {}) => {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = '/api/agent';
  req.headers = { host: 'example.vercel.app', ...headers };
  return req;
};

const makeRes = () => ({
  headers: new Map(), statusCode: undefined, body: undefined,
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
  status(code) { this.statusCode = code; return this; },
  end(body) { this.body = body; },
});

const importAdapter = async () => import(`./agent.mjs?test=${Date.now()}-${Math.random()}`);

test('Vercel adapter converts a Node request and returns the shared handler success response', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENHUB_API_KEY;
  process.env.TOKENHUB_API_KEY = 'server-only-test-key';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://tokenhub.tencentmaas.com/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer server-only-test-key');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validProfile) } }] }), { status: 200 });
  };
  try {
    const { default: handler } = await importAdapter();
    const res = makeRes();
    await handler(makeReq({ body: JSON.stringify({ input: '三天海边慢旅行' }), headers: { 'content-type': 'application/json' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const payload = JSON.parse(res.body);
    assert.equal(payload.meta.mode, 'live');
    assert.equal(payload.meta.provider, 'tokenhub');
    assert.deepEqual(payload.profile, validProfile);
    assert.doesNotMatch(res.body, /server-only-test-key/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENHUB_API_KEY;
    else process.env.TOKENHUB_API_KEY = originalKey;
  }
});

test('Vercel adapter preserves the shared handler error status, payload, and Allow header', async () => {
  const { default: handler } = await importAdapter();
  const res = makeRes();
  await handler(makeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.deepEqual(JSON.parse(res.body).error, { code: 'method_not_allowed', message: '仅支持 POST 请求。' });
  assert.equal(JSON.parse(res.body).meta.mode, 'unavailable');
});
