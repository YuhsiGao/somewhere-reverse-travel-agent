import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTokenHubConnection, TOKENHUB_GATEWAY } from './tokenhub-connection.mjs';

const request = (headers = {}) => new Request('https://example.test/api/agent', { method: 'POST', headers });

test('uses a bounded browser BYOK override without exposing it', () => {
  const result = resolveTokenHubConnection(request({
    'x-somewhere-gateway': `${TOKENHUB_GATEWAY}/`,
    'x-somewhere-model': 'hunyuan-t1',
    'x-somewhere-api-key': 'user-owned-key',
  }), { TOKENHUB_API_KEY: 'deployment-key', TOKENHUB_BASE_URL: 'https://internal.test' }, 'hy3');
  assert.deepEqual(result, { gateway: TOKENHUB_GATEWAY, model: 'hunyuan-t1', apiKey: 'user-owned-key' });
});

test('never falls back to a server-side key', () => {
  assert.deepEqual(resolveTokenHubConnection(request({}), { TOKENHUB_API_KEY: 'deployment-key' }, 'hy3'), { error: 'missing_key' });
});

test('refuses browser-provided custom gateway and malformed models', () => {
  assert.deepEqual(resolveTokenHubConnection(request({ 'x-somewhere-gateway': 'https://not-allowed.example' }), { TOKENHUB_API_KEY: 'key' }, 'hy3'), { error: 'invalid_gateway' });
  assert.deepEqual(resolveTokenHubConnection(request({ 'x-somewhere-model': 'bad model name' }), { TOKENHUB_API_KEY: 'key' }, 'hy3'), { error: 'invalid_model' });
});
