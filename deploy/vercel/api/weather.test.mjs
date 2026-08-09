import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

const input = { coordinates: [119.485, 28.454], date: '2026-08-06' };
const upstream = { daily: { time: ['2026-08-06'], weather_code: [61], temperature_2m_max: [27.2], temperature_2m_min: [20.3], precipitation_probability_max: [70], wind_speed_10m_max: [18] } };
const makeReq = ({ method = 'POST', body = '', headers = {} } = {}) => { const req = Readable.from(body ? [Buffer.from(body)] : []); req.method = method; req.url = '/api/weather'; req.headers = { host: 'example.vercel.app', ...headers }; return req; };
const makeRes = () => ({ headers: new Map(), statusCode: undefined, body: undefined, setHeader(name, value) { this.headers.set(name.toLowerCase(), value); }, status(code) { this.statusCode = code; return this; }, end(body) { this.body = body; } });
const importAdapter = async () => import(`./weather.mjs?test=${Date.now()}-${Math.random()}`);

test('Vercel weather adapter disables body parsing and preserves the safe forecast contract', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const parsed = new URL(url); assert.equal(parsed.origin + parsed.pathname, 'https://api.open-meteo.com/v1/forecast'); assert.equal(parsed.searchParams.get('forecast_days'), '16'); assert.equal(init.headers.accept, 'application/json'); return new Response(JSON.stringify(upstream), { status: 200 }); };
  try {
    const module = await importAdapter(); assert.deepEqual(module.config, { api: { bodyParser: false } });
    const res = makeRes(); await module.default(makeReq({ body: JSON.stringify(input), headers: { 'content-type': 'application/json' } }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); const body = JSON.parse(res.body); assert.deepEqual(body.forecast, { date: input.date, weatherCode: 61, minC: 20.3, maxC: 27.2, precipitationProbabilityMax: 70, windSpeedMax: 18 }); assert.equal(body.meta.provider, 'open-meteo');
  } finally { globalThis.fetch = originalFetch; }
});

test('Vercel weather adapter retains method and payload-limit errors', async () => {
  const { default: handler } = await importAdapter();
  const method = makeRes(); await handler(makeReq({ method: 'GET' }), method); assert.equal(method.statusCode, 405); assert.equal(method.headers.get('allow'), 'POST');
  const oversized = makeRes(); await handler(makeReq({ body: JSON.stringify({ ...input, padding: 'x'.repeat(3000) }), headers: { 'content-type': 'application/json' } }), oversized); assert.equal(oversized.statusCode, 413); assert.equal(JSON.parse(oversized.body).error.code, 'body_too_large');
});
