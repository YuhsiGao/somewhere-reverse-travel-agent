import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedRateGovernor } from './shared-rate-governor.mjs';

const env = { UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'x'.repeat(20) };

test('uses an atomic NX + PX REST command when shared governance is configured', async () => {
  let captured;
  const governor = createSharedRateGovernor({ env, fetch: async (url, init) => { captured = { url: String(url), init }; return new Response(JSON.stringify({ result: 'OK' })); } });
  assert.equal(await governor.reserve('nominatim', 1_000), 'granted');
  assert.match(captured.url, /\/set\/somewhere%3Apublic-rate%3Anominatim\/1\/NX\/PX\/1000$/);
  assert.match(captured.init.headers.authorization, /^Bearer /);
});

test('fails closed only when configured, and remains optional for local development', async () => {
  const denied = createSharedRateGovernor({ env, fetch: async () => new Response(JSON.stringify({ result: null })) });
  assert.equal(await denied.reserve('osrm', 1_000), 'denied');
  const unavailable = createSharedRateGovernor({ env, fetch: async () => { throw new Error('offline'); } });
  assert.equal(await unavailable.reserve('osrm', 1_000), 'unavailable');
  const local = createSharedRateGovernor({ env: {} });
  assert.equal(await local.reserve('osrm', 1_000), 'not-configured');
});
