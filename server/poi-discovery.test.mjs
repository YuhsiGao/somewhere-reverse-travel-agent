import assert from 'node:assert/strict';
import test from 'node:test';
import { createPoiDiscoveryHandler, distanceKmBetween, sanitizeDiscoveredPoi, validatePoiDiscoveryInput } from './poi-discovery.mjs';

const input = { query: 'museum', coordinates: [119.485, 28.454] };
const upstreamPlaces = [
  { name: '松阳博物馆', type: 'museum', osm_type: 'way', osm_id: 987, lat: '28.4541', lon: '119.4852', extratags: { private: 'do not expose' } },
  { display_name: '西屏公园, 松阳县', type: 'park', osm_type: 'node', osm_id: 654, lat: '28.455', lon: '119.486' },
];
const request = (body, init = {}) => new Request('https://example.test/api/poi-discovery', { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body, ...init });
const handler = (overrides = {}) => createPoiDiscoveryHandler({
  env: { NOMINATIM_USER_AGENT: 'Somewhere-POI-Discovery/1.0 (contact: travel@example.test)' },
  createRequestId: () => 'req_discovery', now: () => new Date('2026-08-04T00:00:00.000Z'),
  fetch: async () => new Response(JSON.stringify(upstreamPlaces), { status: 200 }), ...overrides,
});

test('rejects non-POST, non-JSON, malformed and non-contract inputs before upstream', async () => {
  assert.equal((await handler()(new Request('https://example.test/api/poi-discovery'))).status, 405);
  assert.equal((await handler()(new Request('https://example.test/api/poi-discovery', { method: 'POST', body: '{}' }))).status, 415);
  assert.deepEqual(validatePoiDiscoveryInput(input), input);
  assert.equal(validatePoiDiscoveryInput({ ...input, query: 'restaurant' }), null);
  assert.equal(validatePoiDiscoveryInput({ ...input, query: ' Museum' }), null);
  assert.equal(validatePoiDiscoveryInput({ ...input, extra: true }), null);
  let called = false;
  const guarded = handler({ fetch: async () => { called = true; throw new Error('must not run'); } });
  assert.equal((await guarded(request(JSON.stringify({ query: 'cafe', coordinates: [0] })))).status, 400);
  assert.equal(called, false);
});

test('uses a bounded Nominatim search and returns at most five minimized OSM places', async () => {
  let captured;
  const response = await handler({ fetch: async (url, init) => { captured = { url: String(url), init }; return new Response(JSON.stringify(upstreamPlaces), { status: 200 }); } })(request(JSON.stringify(input)));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.meta, { provider: 'openstreetmap-nominatim', updatedAt: '2026-08-04T00:00:00.000Z', requestId: 'req_discovery' });
  assert.deepEqual(payload.places[0], { name: '松阳博物馆', type: 'museum', osmType: 'way', osmId: 987, coordinates: [119.4852, 28.4541], sourceUrl: 'https://www.openstreetmap.org/way/987', distanceKm: 0 });
  assert.ok(payload.places[0].distanceKm <= payload.places[1].distanceKm);
  assert.equal(payload.places.length, 2); assert.doesNotMatch(JSON.stringify(payload), /extratags|private/);
  const params = new URL(captured.url).searchParams;
  assert.equal(new URL(captured.url).pathname, '/search'); assert.equal(params.get('q'), 'museum'); assert.equal(params.get('limit'), '5'); assert.equal(params.get('bounded'), '1'); assert.match(params.get('viewbox'), /^[\d.,-]+$/);
  assert.equal(captured.init.headers.accept, 'application/json'); assert.match(captured.init.headers['user-agent'], /^Somewhere-POI-Discovery/);
});

test('caches successful results and serializes public upstream calls', async () => {
  let calls = 0; let clock = 0; const sleeps = [];
  const cached = handler({ nowMs: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, fetch: async () => { calls += 1; return new Response(JSON.stringify(upstreamPlaces), { status: 200 }); } });
  assert.equal((await cached(request(JSON.stringify(input)))).status, 200);
  assert.equal((await cached(request(JSON.stringify(input)))).status, 200); assert.equal(calls, 1);
  assert.equal((await cached(request(JSON.stringify({ ...input, query: 'park' })))).status, 200);
  assert.equal(calls, 2); assert.deepEqual(sleeps, [1_000]);
});

test('returns safe configuration, upstream, invalid-payload, size and timeout errors', async () => {
  assert.equal((await handler({ env: {} })(request(JSON.stringify(input)))).status, 503);
  assert.equal((await handler({ fetch: async () => new Response('secret upstream', { status: 429 }) })(request(JSON.stringify(input)))).status, 502);
  assert.equal((await handler({ fetch: async () => new Response('{}', { status: 200 }) })(request(JSON.stringify(input)))).status, 502);
  const oversized = await handler({ fetch: async () => { throw new Error('must not run'); } })(request(JSON.stringify({ ...input, pad: 'x'.repeat(4096) })));
  assert.equal(oversized.status, 413);
  const timeout = await handler({ timeoutMs: 1, fetch: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) })(request(JSON.stringify(input)));
  assert.equal(timeout.status, 504);
  assert.equal(sanitizeDiscoveredPoi({ ...upstreamPlaces[0], osm_type: 'bad' }), null);
  assert.equal(Number(distanceKmBetween([119.485, 28.454], [119.485, 28.454]).toFixed(2)), 0);
});
