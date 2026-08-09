import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

const upstream = [{ name: '松阳博物馆', type: 'museum', osm_type: 'way', osm_id: 123, lat: '28.454', lon: '119.485' }];
const makeReq = ({ method = 'POST', body = '', headers = {} } = {}) => { const req = Readable.from(body ? [Buffer.from(body)] : []); req.method = method; req.url = '/api/poi-discovery'; req.headers = { host: 'example.vercel.app', ...headers }; return req; };
const makeRes = () => ({ headers: new Map(), statusCode: undefined, body: undefined, setHeader(name, value) { this.headers.set(name.toLowerCase(), value); }, status(code) { this.statusCode = code; return this; }, end(body) { this.body = body; } });
const importAdapter = async () => import(`./poi-discovery.mjs?test=${Date.now()}-${Math.random()}`);

test('Vercel POI discovery adapter disables body parsing and preserves the shared contract', async () => {
  const originalFetch = globalThis.fetch; const originalAgent = process.env.NOMINATIM_USER_AGENT;
  process.env.NOMINATIM_USER_AGENT = 'Somewhere-POI-Discovery/1.0 (contact: travel@example.test)';
  globalThis.fetch = async (url, options) => { assert.match(String(url), /\/search\?/); assert.equal(options.headers.accept, 'application/json'); return new Response(JSON.stringify(upstream), { status: 200 }); };
  try {
    const module = await importAdapter(); assert.deepEqual(module.config, { api: { bodyParser: false } });
    const res = makeRes(); await module.default(makeReq({ body: JSON.stringify({ query: 'museum', coordinates: [119.485, 28.454] }), headers: { 'content-type': 'application/json' } }), res);
    assert.equal(res.statusCode, 200); const payload = JSON.parse(res.body); assert.equal(payload.meta.provider, 'openstreetmap-nominatim'); assert.deepEqual(payload.places[0].coordinates, [119.485, 28.454]);
  } finally { globalThis.fetch = originalFetch; if (originalAgent === undefined) delete process.env.NOMINATIM_USER_AGENT; else process.env.NOMINATIM_USER_AGENT = originalAgent; }
});

test('Vercel POI discovery adapter preserves method and input errors', async () => {
  const { default: handler } = await importAdapter();
  const methodRes = makeRes(); await handler(makeReq({ method: 'GET' }), methodRes); assert.equal(methodRes.statusCode, 405);
  const invalidRes = makeRes(); await handler(makeReq({ body: JSON.stringify({ query: 'hotel', coordinates: [0, 0] }), headers: { 'content-type': 'application/json' } }), invalidRes); assert.equal(invalidRes.statusCode, 400);
});
