import assert from 'node:assert/strict';
import test from 'node:test';
import { createTokenHubAgentHandler, validateVibeProfile } from './tokenhub-agent.mjs';

const validProfile = { summary: '一段安静、适合散步的短途旅行。', emotions: [{ label: '安静', score: 90 }, { label: '步行', score: 87 }, { label: '松弛', score: 82 }, { label: '独处', score: 78 }], environments: ['海边', '旧街区'], pace: '慢速', socialDensity: '独处为主', climate: '偏冷', constraints: ['3 天'] };
const request = (body, init = {}) => new Request('https://example.test/api/agent', { ...init, method: 'POST', headers: { 'content-type': 'application/json', 'x-somewhere-api-key': 'test-secret', ...init.headers }, body });
const handler = (overrides = {}) => createTokenHubAgentHandler({
  env: { TOKENHUB_API_KEY: 'test-secret', TOKENHUB_BASE_URL: 'https://tokenhub.test' },
  createRequestId: () => 'req_test', now: () => new Date('2026-08-04T00:00:00.000Z'),
  fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validProfile) } }] }), { status: 200 }), ...overrides,
});

test('rejects non-POST and provides safe meta', async () => {
  const response = await handler()(new Request('https://example.test/api/agent'));
  assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST');
  assert.deepEqual(await response.json(), { error: { code: 'method_not_allowed', message: '仅支持 POST 请求。' }, meta: { mode: 'unavailable', requestId: 'req_test', generatedAt: '2026-08-04T00:00:00.000Z' } });
});

test('only accepts JSON with exactly one valid input field', async () => {
  assert.equal((await handler()(new Request('https://example.test/api/agent', { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await handler()(request(JSON.stringify({ input: '去散步', scenario: 'harbor' })))).status, 400);
  assert.equal((await handler()(request(JSON.stringify({ input: '旅'.repeat(2001) })))).status, 400);
});

test('enforces the 20KB body limit before invoking TokenHub', async () => {
  let called = false;
  const response = await handler({ fetch: async () => { called = true; throw new Error('must not run'); } })(request(JSON.stringify({ input: '旅', padding: 'x'.repeat(21 * 1024) })));
  assert.equal(response.status, 413); assert.equal(called, false); assert.equal((await response.json()).error.code, 'body_too_large');
});

test('returns a validated profile and does not expose the secret', async () => {
  let captured;
  const response = await handler({ fetch: async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(validProfile)}\n\`\`\`` } }] }), { status: 200 }); } })(request(JSON.stringify({ input: '我想在海边安静走三天。' })));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.profile, validProfile); assert.equal(payload.meta.mode, 'live'); assert.equal(payload.meta.requestId, 'req_test');
  assert.match(captured.url, /tokenhub\.tencentmaas\.com\/v1\/chat\/completions$/); assert.equal(captured.init.headers.authorization, 'Bearer test-secret'); assert.doesNotMatch(JSON.stringify(payload), /test-secret/);
});

test('fails safely for missing configuration and malformed upstream content', async () => {
  const unconfigured = await handler({ env: {} })(request(JSON.stringify({ input: '周末想安静一点' }), { headers: { 'x-somewhere-api-key': '' } }));
  assert.equal(unconfigured.status, 503); assert.equal((await unconfigured.json()).error.code, 'service_not_configured');
  const malformed = await handler({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"only"}' } }] }), { status: 200 }) })(request(JSON.stringify({ input: '周末想安静一点' })));
  assert.equal(malformed.status, 502); assert.equal((await malformed.json()).error.code, 'invalid_upstream_profile');
});

test('turns upstream failures and client aborts into safe JSON errors', async () => {
  const rejected = await handler({ fetch: async () => new Response('secret upstream body', { status: 401 }) })(request(JSON.stringify({ input: '周末想安静一点' })));
  assert.equal(rejected.status, 502); assert.equal((await rejected.json()).error.code, 'upstream_rejected');
  const controller = new AbortController(); controller.abort();
  const aborted = await handler({ fetch: async () => { throw new DOMException('aborted', 'AbortError'); } })(request(JSON.stringify({ input: '周末想安静一点' }), { signal: controller.signal }));
  assert.equal(aborted.status, 499); assert.equal((await aborted.json()).error.code, 'request_aborted');
});

test('enforces the 12-second upstream timeout through an injectable clock in tests', async () => {
  const response = await handler({
    timeoutMs: 1,
    fetch: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
  })(request(JSON.stringify({ input: '周末想安静一点' })));
  assert.equal(response.status, 504); assert.equal((await response.json()).error.code, 'upstream_timeout');
});

test('profile validation enforces the declared VibeProfile contract', () => {
  assert.deepEqual(validateVibeProfile(validProfile), validProfile);
  assert.equal(validateVibeProfile({ ...validProfile, emotions: [{ label: '安静', score: 90 }] }), null);
  assert.equal(validateVibeProfile({ ...validProfile, emotions: validProfile.emotions.map((item) => ({ ...item, score: 101 })) }), null);
});
