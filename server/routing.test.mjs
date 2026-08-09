import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoutingHandler, validateRouteInput } from './routing.mjs';

const input = { mode: 'walk', coordinates: [[119.485, 28.454], [119.49, 28.46]] };
const upstreamRoute = { code: 'Ok', routes: [{ distance: 1820.4, duration: 1432.2, geometry: { type: 'LineString', coordinates: input.coordinates } }] };
const request = (body, init = {}) => new Request('https://example.test/api/route', { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body, ...init });
const handler = (overrides = {}) => createRoutingHandler({
  env: { OSRM_URL: 'https://routing.example.test' }, createRequestId: () => 'req_route', now: () => new Date('2026-08-04T00:00:00.000Z'),
  fetch: async () => new Response(JSON.stringify(upstreamRoute), { status: 200 }), ...overrides,
});

test('rejects non-POST and non-JSON requests safely', async () => {
  const notPost = await handler()(new Request('https://example.test/api/route'));
  assert.equal(notPost.status, 405); assert.equal(notPost.headers.get('allow'), 'POST');
  const nonJson = await handler()(new Request('https://example.test/api/route', { method: 'POST', body: '{}' }));
  assert.equal(nonJson.status, 415);
});

test('strictly validates modes, fields, coordinate count and coordinate bounds before upstream', async () => {
  assert.deepEqual(validateRouteInput(input), input);
  assert.equal(validateRouteInput({ ...input, extra: true }), null);
  assert.equal(validateRouteInput({ ...input, mode: 'public-transit' }), null);
  assert.equal(validateRouteInput({ ...input, coordinates: [[0, 0]] }), null);
  assert.equal(validateRouteInput({ ...input, coordinates: Array.from({ length: 13 }, () => [0, 0]) }), null);
  assert.equal(validateRouteInput({ ...input, coordinates: [[181, 0], [0, 0]] }), null);
  let called = false;
  const guarded = handler({ fetch: async () => { called = true; throw new Error('must not run'); } });
  const response = await guarded(request(JSON.stringify({ mode: 'public-transit', coordinates: input.coordinates })));
  assert.equal(response.status, 400); assert.equal(called, false);
});

test('preserves the small OSRM route contract and uses the server configured endpoint', async () => {
  let captured;
  const response = await handler({ fetch: async (url, init) => { captured = { url: String(url), init }; return new Response(JSON.stringify(upstreamRoute), { status: 200 }); } })(request(JSON.stringify(input)));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.code, 'Ok');
  assert.deepEqual(payload.routes, upstreamRoute.routes);
  assert.deepEqual(payload.meta, { provider: 'osrm', updatedAt: '2026-08-04T00:00:00.000Z', requestId: 'req_route', cache: 'miss' });
  assert.match(captured.url, /^https:\/\/routing\.example\.test\/route\/v1\/walking\//);
  assert.match(captured.url, /geometries=geojson/); assert.equal(captured.init.headers.accept, 'application/json');
});

test('success cache prevents duplicate upstream calls and preserves a fresh meta time', async () => {
  let calls = 0;
  let nowMs = 10;
  const routeHandler = handler({ nowMs: () => nowMs, fetch: async () => { calls += 1; return new Response(JSON.stringify(upstreamRoute), { status: 200 }); } });
  const first = await routeHandler(request(JSON.stringify(input)));
  nowMs += 1;
  const second = await routeHandler(request(JSON.stringify(input)));
  assert.equal(calls, 1); assert.equal((await first.json()).meta.cache, 'miss'); assert.equal((await second.json()).meta.cache, 'hit');
});

test('limits the public demo endpoint to one request per second but does not throttle configured OSRM', async () => {
  let slept = 0;
  const publicHandler = createRoutingHandler({ env: {}, nowMs: () => 0, sleep: async (ms) => { slept = ms; }, fetch: async () => new Response(JSON.stringify(upstreamRoute), { status: 200 }) });
  await publicHandler(request(JSON.stringify(input)));
  await publicHandler(request(JSON.stringify({ ...input, mode: 'bike' })));
  assert.equal(slept, 1000);
});

test('does not call public OSRM when the configured shared governor denies the global slot', async () => {
  let called = false;
  const publicHandler = createRoutingHandler({ env: {}, sharedGovernor: { reserve: async () => 'denied' }, fetch: async () => { called = true; throw new Error('must not run'); } });
  const response = await publicHandler(request(JSON.stringify(input)));
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '1');
  assert.equal((await response.json()).error.code, 'public_rate_limited'); assert.equal(called, false);
});

test('turns no route, malformed upstream, rejection, network errors and timeouts into safe errors', async () => {
  const noRoute = await handler({ fetch: async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 200 }) })(request(JSON.stringify(input)));
  assert.equal(noRoute.status, 404); assert.equal((await noRoute.json()).error.code, 'no_route');
  const malformed = await handler({ fetch: async () => new Response(JSON.stringify({ code: 'Ok', routes: [{}] }), { status: 200 }) })(request(JSON.stringify(input)));
  assert.equal(malformed.status, 502); assert.equal((await malformed.json()).error.code, 'invalid_upstream_response');
  const rejected = await handler({ fetch: async () => new Response('private upstream body', { status: 429 }) })(request(JSON.stringify(input)));
  assert.equal(rejected.status, 502); assert.equal((await rejected.json()).error.code, 'upstream_rejected');
  const unavailable = await handler({ fetch: async () => { throw new Error('network details'); } })(request(JSON.stringify(input)));
  assert.equal(unavailable.status, 502); assert.equal((await unavailable.json()).error.code, 'upstream_unavailable');
  const timeout = await handler({ timeoutMs: 1, fetch: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) })(request(JSON.stringify(input)));
  assert.equal(timeout.status, 504); assert.equal((await timeout.json()).error.code, 'upstream_timeout');
});

test('enforces the 8KB body limit without calling OSRM', async () => {
  let called = false;
  const response = await handler({ fetch: async () => { called = true; throw new Error('must not run'); } })(request(JSON.stringify({ ...input, padding: 'x'.repeat(9000) })));
  assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'body_too_large'); assert.equal(called, false);
});
