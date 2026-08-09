import assert from 'node:assert/strict';
import test from 'node:test';
import { createPoiVerificationHandler, sanitizeNearbyReference, validatePoiVerificationInput } from './poi-verification.mjs';

const input = { name: '松阳老街', coordinates: [119.485, 28.454] };
const upstreamPlace = { display_name: '松阳老街, 松阳县, 丽水市, 浙江省, 中国', osm_type: 'way', osm_id: 987654, lat: '28.4541', lon: '119.4852' };
const request = (body, init = {}) => new Request('https://example.test/api/poi-verification', { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body, ...init });
const handler = (overrides = {}) => createPoiVerificationHandler({
  env: { NOMINATIM_USER_AGENT: 'Somewhere-POI-Verification/1.0 (contact: travel@example.test)' },
  createRequestId: () => 'req_poi', now: () => new Date('2026-08-04T00:00:00.000Z'),
  fetch: async () => new Response(JSON.stringify(upstreamPlace), { status: 200 }), ...overrides,
});

test('rejects non-POST and non-JSON requests safely', async () => {
  const notPost = await handler()(new Request('https://example.test/api/poi-verification'));
  assert.equal(notPost.status, 405); assert.equal(notPost.headers.get('allow'), 'POST');
  const nonJson = await handler()(new Request('https://example.test/api/poi-verification', { method: 'POST', body: '{}' }));
  assert.equal(nonJson.status, 415);
});

test('strictly validates the small POI input contract before calling upstream', async () => {
  assert.deepEqual(validatePoiVerificationInput(input), input);
  assert.equal(validatePoiVerificationInput({ ...input, extra: true }), null);
  assert.equal(validatePoiVerificationInput({ ...input, name: 'x'.repeat(121) }), null);
  assert.equal(validatePoiVerificationInput({ ...input, coordinates: [181, 0] }), null);
  let called = false;
  const guarded = handler({ fetch: async () => { called = true; throw new Error('must not run'); } });
  assert.equal((await guarded(request(JSON.stringify({ name: 'x', coordinates: [1] })))).status, 400);
  assert.equal((await guarded(request(JSON.stringify({ ...input, extra: true })))).status, 400);
  assert.equal(called, false);
});

test('returns a minimized nearby OSM reference and never treats it as an identity match', async () => {
  let captured;
  const response = await handler({ fetch: async (url, init) => { captured = { url: String(url), init }; return new Response(JSON.stringify(upstreamPlace), { status: 200 }); } })(request(JSON.stringify(input)));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.meta, { provider: 'openstreetmap-nominatim', updatedAt: '2026-08-04T00:00:00.000Z', requestId: 'req_poi' });
  assert.deepEqual(payload.match, { reference: 'nearby_reference', displayName: upstreamPlace.display_name, osmType: 'way', osmId: 987654, coordinate: [119.4852, 28.4541], distanceMeters: 22, sourceUrl: 'https://www.openstreetmap.org/way/987654' });
  assert.match(captured.url, /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
  assert.match(captured.url, /format=jsonv2/); assert.equal(captured.init.headers.accept, 'application/json');
  assert.match(captured.init.headers['user-agent'], /^Somewhere-POI-Verification/);
  assert.doesNotMatch(JSON.stringify(payload), /松阳老街.*松阳老街/);
});

test('rejects invalid upstream payloads and requires a legal server-side User-Agent', async () => {
  assert.equal(sanitizeNearbyReference({ ...upstreamPlace, osm_type: 'unknown' }, input.coordinates), null);
  const invalid = await handler({ fetch: async () => new Response('{}', { status: 200 }) })(request(JSON.stringify(input)));
  assert.equal(invalid.status, 404); assert.equal((await invalid.json()).error.code, 'nearby_reference_not_found');
  const unconfigured = await handler({ env: {} })(request(JSON.stringify(input)));
  assert.equal(unconfigured.status, 503); assert.equal((await unconfigured.json()).error.code, 'service_not_configured');
});

test('turns upstream rejection, failure and timeout into safe errors', async () => {
  const rejected = await handler({ fetch: async () => new Response('private upstream body', { status: 429 }) })(request(JSON.stringify(input)));
  assert.equal(rejected.status, 502); assert.equal((await rejected.json()).error.code, 'upstream_rejected');
  const unavailable = await handler({ fetch: async () => { throw new Error('network details'); } })(request(JSON.stringify(input)));
  assert.equal(unavailable.status, 502); assert.equal((await unavailable.json()).error.code, 'upstream_unavailable');
  const timeout = await handler({ timeoutMs: 1, fetch: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) })(request(JSON.stringify(input)));
  assert.equal(timeout.status, 504); assert.equal((await timeout.json()).error.code, 'upstream_timeout');
});

test('enforces a 4KB body limit without contacting Nominatim', async () => {
  let called = false;
  const response = await handler({ fetch: async () => { called = true; throw new Error('must not run'); } })(request(JSON.stringify({ ...input, name: 'x'.repeat(4096) })));
  assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'body_too_large'); assert.equal(called, false);
});
