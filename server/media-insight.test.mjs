import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaInsightHandler, validateImageDataUrl, validateMediaInsight, validatePublicImageUrl } from './media-insight.mjs';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const validInsight = { summary: '温暖、安静的城市慢游灵感。', tags: ['安静', '咖啡', '散步'] };
const request = (body, init = {}) => new Request('https://example.test/api/media-insight', { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body, ...init });
const handler = (overrides = {}) => createMediaInsightHandler({
  env: { TOKENHUB_API_KEY: 'test-secret', TOKENHUB_BASE_URL: 'https://tokenhub.test' },
  createRequestId: () => 'req_media', now: () => new Date('2026-08-04T00:00:00.000Z'),
  fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validInsight) } }] }), { status: 200 }), ...overrides,
});

test('rejects non-POST and non-JSON requests safely', async () => {
  const notPost = await handler()(new Request('https://example.test/api/media-insight'));
  assert.equal(notPost.status, 405); assert.equal(notPost.headers.get('allow'), 'POST');
  const nonJson = await handler()(new Request('https://example.test/api/media-insight', { method: 'POST', body: '{}' }));
  assert.equal(nonJson.status, 415);
});

test('strictly validates allowed base64 image data URLs', () => {
  assert.deepEqual(validateImageDataUrl(image), { dataUrl: image, mimeType: 'image/png' });
  assert.equal(validateImageDataUrl('https://example.test/image.png'), null);
  assert.equal(validateImageDataUrl('data:image/gif;base64,QUJDRA=='), null);
  assert.equal(validateImageDataUrl('data:image/png;base64,abcd*==='), null);
  assert.equal(validateImageDataUrl('data:image/png;base64,AAA='), null);
});

test('accepts only public HTTPS image links for relay to the vision model', () => {
  assert.equal(validatePublicImageUrl('https://images.example.com/travel.jpg'), 'https://images.example.com/travel.jpg');
  assert.equal(validatePublicImageUrl('http://images.example.com/travel.jpg'), null);
  assert.equal(validatePublicImageUrl('https://localhost/photo.jpg'), null);
  assert.equal(validatePublicImageUrl('https://192.168.1.1/photo.jpg'), null);
  assert.equal(validatePublicImageUrl('https://user:pass@images.example.com/photo.jpg'), null);
});

test('rejects unexpected fields, invalid images and invalid descriptions before upstream calls', async () => {
  let called = false;
  const guarded = handler({ fetch: async () => { called = true; throw new Error('must not run'); } });
  assert.equal((await guarded(request(JSON.stringify({ imageDataUrl: image, filename: 'private.png' })))).status, 400);
  assert.equal((await guarded(request(JSON.stringify({ imageDataUrl: 'data:image/gif;base64,QUJDRA==' })))).status, 400);
  assert.equal((await guarded(request(JSON.stringify({ imageDataUrl: image, description: 'x'.repeat(1001) })))).status, 400);
  assert.equal(called, false);
});

test('enforces the 1.5MB request body limit before invoking TokenHub', async () => {
  let called = false;
  const response = await handler({ fetch: async () => { called = true; throw new Error('must not run'); } })(request(JSON.stringify({ imageDataUrl: image, description: 'x'.repeat(Math.ceil(1.5 * 1024 * 1024)) })));
  assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'body_too_large'); assert.equal(called, false);
});

test('sends only image URL and optional description upstream then returns a sanitized insight', async () => {
  let captured;
  const response = await handler({ fetch: async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(validInsight)}\n\`\`\`` } }] }), { status: 200 }); } })(request(JSON.stringify({ imageDataUrl: image, description: '想找适合慢走的地方' })));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.insight, validInsight); assert.equal(payload.meta.mode, 'live'); assert.equal(payload.meta.requestId, 'req_media');
  assert.match(captured.url, /tokenhub\.test\/v1\/chat\/completions$/); assert.equal(captured.init.headers.authorization, 'Bearer test-secret');
  const upstreamBody = JSON.parse(captured.init.body);
  assert.equal(upstreamBody.model, 'youtu-vita'); assert.equal(upstreamBody.messages[0].content[1].type, 'image_url'); assert.equal(upstreamBody.messages[0].content[1].image_url.url, image);
  assert.doesNotMatch(JSON.stringify(payload), /test-secret|data:image|private\.png/);
});

test('relays an explicitly supplied public image URL without server-side downloading', async () => {
  let upstreamBody;
  const response = await handler({ fetch: async (_url, init) => { upstreamBody = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validInsight) } }] }), { status: 200 }); } })(request(JSON.stringify({ imageUrl: 'https://images.example.com/travel.jpg' })));
  assert.equal(response.status, 200);
  assert.equal(upstreamBody.messages[0].content[1].image_url.url, 'https://images.example.com/travel.jpg');
});

test('supports an explicit media model override and safe error degradation', async () => {
  let model;
  const override = await handler({ env: { TOKENHUB_API_KEY: 'test-secret', TOKENHUB_MEDIA_MODEL: 'vision-override' }, fetch: async (_url, init) => { model = JSON.parse(init.body).model; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validInsight) } }] }), { status: 200 }); } })(request(JSON.stringify({ imageDataUrl: image })));
  assert.equal(override.status, 200); assert.equal(model, 'vision-override');
  const unconfigured = await handler({ env: {} })(request(JSON.stringify({ imageDataUrl: image })));
  assert.equal(unconfigured.status, 503); assert.equal((await unconfigured.json()).error.code, 'service_not_configured');
  const malformed = await handler({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"only"}' } }] }), { status: 200 }) })(request(JSON.stringify({ imageDataUrl: image })));
  assert.equal(malformed.status, 502); assert.equal((await malformed.json()).error.code, 'invalid_upstream_insight');
});

test('turns upstream failures, client aborts and timeouts into safe errors', async () => {
  const rejected = await handler({ fetch: async () => new Response('secret upstream body', { status: 401 }) })(request(JSON.stringify({ imageDataUrl: image })));
  assert.equal(rejected.status, 502); assert.equal((await rejected.json()).error.code, 'upstream_rejected');
  const controller = new AbortController(); controller.abort();
  const aborted = await handler({ fetch: async () => { throw new DOMException('aborted', 'AbortError'); } })(request(JSON.stringify({ imageDataUrl: image }), { signal: controller.signal }));
  assert.equal(aborted.status, 499); assert.equal((await aborted.json()).error.code, 'request_aborted');
  const timeout = await handler({ timeoutMs: 1, fetch: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) })(request(JSON.stringify({ imageDataUrl: image })));
  assert.equal(timeout.status, 504); assert.equal((await timeout.json()).error.code, 'upstream_timeout');
});

test('validates the exact response contract', () => {
  assert.deepEqual(validateMediaInsight(validInsight), validInsight);
  assert.equal(validateMediaInsight({ ...validInsight, tags: ['一个', '两个'] }), null);
  assert.equal(validateMediaInsight({ ...validInsight, tags: ['重复', '重复', '第三'] }), null);
  assert.equal(validateMediaInsight({ ...validInsight, summary: 'x'.repeat(241) }), null);
});
