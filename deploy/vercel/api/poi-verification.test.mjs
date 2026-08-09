import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

const upstreamPlace = { display_name: '松阳老街, 松阳县', osm_type: 'way', osm_id: 123, lat: '28.454', lon: '119.485' };
const makeReq = ({ method = 'POST', body = '', headers = {} } = {}) => {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method; req.url = '/api/poi-verification'; req.headers = { host: 'example.vercel.app', ...headers };
  return req;
};
const makeRes = () => ({
  headers: new Map(), statusCode: undefined, body: undefined,
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
  status(code) { this.statusCode = code; return this; }, end(body) { this.body = body; },
});
const importAdapter = async () => import(`./poi-verification.mjs?test=${Date.now()}-${Math.random()}`);

test('Vercel POI adapter disables body parsing and returns the shared nearby-reference contract', async () => {
  const originalFetch = globalThis.fetch;
  const originalAgent = process.env.NOMINATIM_USER_AGENT;
  process.env.NOMINATIM_USER_AGENT = 'Somewhere-POI-Verification/1.0 (contact: travel@example.test)';
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
    assert.equal(options.headers.accept, 'application/json');
    return new Response(JSON.stringify(upstreamPlace), { status: 200 });
  };
  try {
    const module = await importAdapter();
    assert.deepEqual(module.config, { api: { bodyParser: false } });
    const res = makeRes();
    await module.default(makeReq({ body: JSON.stringify({ name: '松阳老街', coordinates: [119.485, 28.454] }), headers: { 'content-type': 'application/json' } }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
    const payload = JSON.parse(res.body);
    assert.equal(payload.meta.provider, 'openstreetmap-nominatim'); assert.equal(payload.match.sourceUrl, 'https://www.openstreetmap.org/way/123');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAgent === undefined) delete process.env.NOMINATIM_USER_AGENT;
    else process.env.NOMINATIM_USER_AGENT = originalAgent;
  }
});

test('Vercel POI adapter preserves shared method and oversized-body errors', async () => {
  const { default: handler } = await importAdapter();
  const methodRes = makeRes(); await handler(makeReq({ method: 'GET' }), methodRes);
  assert.equal(methodRes.statusCode, 405); assert.equal(methodRes.headers.get('allow'), 'POST');
  const oversizedRes = makeRes();
  await handler(makeReq({ body: JSON.stringify({ name: 'x'.repeat(4096), coordinates: [0, 0] }), headers: { 'content-type': 'application/json' } }), oversizedRes);
  assert.equal(oversizedRes.statusCode, 413); assert.equal(JSON.parse(oversizedRes.body).error.code, 'body_too_large');
});
