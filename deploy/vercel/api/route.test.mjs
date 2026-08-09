import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

const input = { mode: 'walk', coordinates: [[119.485, 28.454], [119.49, 28.46]] };
const route = { code: 'Ok', routes: [{ distance: 1820, duration: 1432, geometry: { type: 'LineString', coordinates: input.coordinates } }] };
const makeReq = ({ method = 'POST', body = '', headers = {} } = {}) => {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method; req.url = '/api/route'; req.headers = { host: 'example.vercel.app', ...headers };
  return req;
};
const makeRes = () => ({ headers: new Map(), statusCode: undefined, body: undefined, setHeader(name, value) { this.headers.set(name.toLowerCase(), value); }, status(code) { this.statusCode = code; return this; }, end(body) { this.body = body; } });
const importAdapter = async () => import(`./route.mjs?test=${Date.now()}-${Math.random()}`);

test('Vercel route adapter disables body parsing and retains the shared route contract', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/router\.project-osrm\.org\/route\/v1\/walking\//);
    assert.equal(options.headers.accept, 'application/json');
    return new Response(JSON.stringify(route), { status: 200 });
  };
  try {
    const module = await importAdapter(); assert.deepEqual(module.config, { api: { bodyParser: false } });
    const res = makeRes(); await module.default(makeReq({ body: JSON.stringify(input), headers: { 'content-type': 'application/json' } }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
    const payload = JSON.parse(res.body); assert.equal(payload.code, 'Ok'); assert.deepEqual(payload.routes, route.routes); assert.equal(payload.meta.provider, 'osrm');
  } finally { globalThis.fetch = originalFetch; }
});

test('Vercel route adapter preserves method and oversized-body errors', async () => {
  const { default: handler } = await importAdapter();
  const methodRes = makeRes(); await handler(makeReq({ method: 'GET' }), methodRes);
  assert.equal(methodRes.statusCode, 405); assert.equal(methodRes.headers.get('allow'), 'POST');
  const oversizedRes = makeRes(); await handler(makeReq({ body: JSON.stringify({ ...input, padding: 'x'.repeat(9000) }), headers: { 'content-type': 'application/json' } }), oversizedRes);
  assert.equal(oversizedRes.statusCode, 413); assert.equal(JSON.parse(oversizedRes.body).error.code, 'body_too_large');
});
