import assert from 'node:assert/strict';
import test from 'node:test';
import { createWeatherHandler, selectForecast, validateWeatherInput } from './weather.mjs';

const input = { coordinates: [119.485, 28.454], date: '2026-08-06' };
const upstream = { daily: { time: ['2026-08-05', '2026-08-06'], weather_code: [1, 61], temperature_2m_max: [31.5, 27.2], temperature_2m_min: [22.1, 20.3], precipitation_probability_max: [10, 70], wind_speed_10m_max: [11, 18] }, ignored: 'not relayed' };
const request = (body, init = {}) => new Request('https://example.test/api/weather', { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body, ...init });
const handler = (overrides = {}) => createWeatherHandler({ createRequestId: () => 'req_weather', now: () => new Date('2026-08-04T00:00:00.000Z'), fetch: async () => new Response(JSON.stringify(upstream), { status: 200 }), ...overrides });

test('rejects non-POST, non-JSON, malformed JSON and oversized payloads safely', async () => {
  assert.equal((await handler()(new Request('https://example.test/api/weather'))).status, 405);
  assert.equal((await handler()(new Request('https://example.test/api/weather', { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await handler()(request('{'))).status, 400);
  const response = await handler()(request(JSON.stringify({ ...input, padding: 'x'.repeat(3000) })));
  assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'body_too_large');
});

test('strictly validates an exact valid date and WGS84 coordinate input', () => {
  assert.deepEqual(validateWeatherInput(input), input);
  assert.equal(validateWeatherInput({ ...input, extra: true }), null);
  assert.equal(validateWeatherInput({ ...input, date: '2026-02-29' }), null);
  assert.equal(validateWeatherInput({ ...input, date: '2026-8-6' }), null);
  assert.equal(validateWeatherInput({ ...input, coordinates: [181, 0] }), null);
  assert.equal(validateWeatherInput({ date: input.date, coordinates: [0] }), null);
});

test('requests the documented Open-Meteo daily fields and returns only the selected safe contract', async () => {
  let captured;
  const response = await handler({ fetch: async (url, init) => { captured = { url: new URL(url), init }; return new Response(JSON.stringify(upstream), { status: 200 }); } })(request(JSON.stringify(input)));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { forecast: { date: '2026-08-06', weatherCode: 61, minC: 20.3, maxC: 27.2, precipitationProbabilityMax: 70, windSpeedMax: 18 }, meta: { provider: 'open-meteo', updatedAt: '2026-08-04T00:00:00.000Z', requestId: 'req_weather', cache: 'miss' } });
  assert.equal(captured.url.origin + captured.url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(captured.url.searchParams.get('latitude'), '28.454'); assert.equal(captured.url.searchParams.get('longitude'), '119.485');
  assert.equal(captured.url.searchParams.get('daily'), 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max');
  assert.equal(captured.url.searchParams.get('timezone'), 'auto'); assert.equal(captured.url.searchParams.get('forecast_days'), '16'); assert.equal(captured.init.headers.accept, 'application/json');
});

test('caches only successful forecasts, with a hard maximum 30-minute TTL', async () => {
  let calls = 0; let current = 0;
  const cached = handler({ nowMs: () => current, cacheTtlMs: 31 * 60 * 1_000, fetch: async () => { calls += 1; return new Response(JSON.stringify(upstream), { status: 200 }); } });
  assert.equal((await cached(request(JSON.stringify(input)))).status, 200);
  current = 29 * 60 * 1_000; assert.equal((await cached(request(JSON.stringify(input)))).status, 200);
  current = 30 * 60 * 1_000; assert.equal((await cached(request(JSON.stringify(input)))).status, 200);
  assert.equal(calls, 2);
});

test('does not expose raw upstream data and handles absent/malformed/upstream failures safely', async () => {
  assert.equal(selectForecast(upstream, '2026-08-20'), undefined); assert.equal(selectForecast({ daily: {} }, input.date), null);
  const absent = await handler()(request(JSON.stringify({ ...input, date: '2026-08-20' })));
  assert.equal(absent.status, 404); assert.equal((await absent.json()).error.code, 'forecast_not_found');
  for (const [fetch, status, code] of [
    [async () => new Response('secret upstream', { status: 429 }), 502, 'upstream_rejected'],
    [async () => new Response('{', { status: 200 }), 502, 'invalid_upstream_response'],
    [async () => { throw new Error('network detail'); }, 502, 'upstream_unavailable'],
  ]) {
    const response = await handler({ fetch })(request(JSON.stringify(input)));
    assert.equal(response.status, status); const body = await response.json(); assert.equal(body.error.code, code); assert.equal(JSON.stringify(body).includes('secret upstream'), false);
  }
});

test('turns the 12 second upstream abort into a safe timeout', async () => {
  const response = await handler({ timeoutMs: 1, fetch: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) })(request(JSON.stringify(input)));
  assert.equal(response.status, 504); assert.equal((await response.json()).error.code, 'upstream_timeout');
});
