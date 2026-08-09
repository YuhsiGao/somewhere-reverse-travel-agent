import assert from 'node:assert/strict';
import test from 'node:test';
import { createDestinationRecallHandler, validateRecallCandidates } from './destination-recall.mjs';

const profile = { summary: '想在冷一点的海边独处并散步。', emotions: [{ label: '安静', score: 90 }], environments: ['海边'] };
const constraints = { scope: 'domestic', days: 2, budget: 'medium', departure: '上海', transport: '高铁 / 火车' };
const candidates = [
  { city: '东山岛', region: '漳州', country: '中国', role: 'best-match', tagline: '海风把一天放慢。', atmosphere: ['海边', '慢走'], reasons: ['适合散步', '留有空白'], tradeoff: '天气需要确认。', budgetNote: '预算需出发前确认。', alternative: '平潭', coordinates: [117.5, 23.72], outline: [{ theme: '沿海慢走', intro: '不赶景点。', anchor: '一段海边步道' }, { theme: '留白收尾', intro: '把时间交给风。', anchor: '一处安静海湾' }] },
  { city: '宁海', region: '宁波', country: '中国', role: 'unexpected', tagline: '山海之间的低音量周末。', atmosphere: ['山路', '海湾'], reasons: ['节奏松', '适合独处'], tradeoff: '交通要确认。', budgetNote: '以实际预订为准。', alternative: '台州', coordinates: [121.43, 29.29], outline: [{ theme: '海湾起步', intro: '慢慢进入周末。', anchor: '一段海湾步道' }, { theme: '山路留白', intro: '只走一小段。', anchor: '一条低强度山路' }] },
  { city: '温岭', region: '台州', country: '中国', role: 'easy-to-reach', tagline: '近一点，也可以把生活调静。', atmosphere: ['石塘', '海风'], reasons: ['短途可考虑', '日常感强'], tradeoff: '旺季人流要确认。', budgetNote: '价格随日期变化。', alternative: '象山', coordinates: [121.37, 28.37], outline: [{ theme: '看海不赶路', intro: '把移动变轻。', anchor: '一段海岸线' }, { theme: '黄昏停坐', intro: '晚一点再回去。', anchor: '一处海边坐点' }] },
];

const request = (body, init = {}) => new Request('https://example.test/api/destination-recall', { ...init, method: 'POST', headers: { 'content-type': 'application/json', 'x-somewhere-api-key': 'test-secret', ...init.headers }, body: JSON.stringify(body) });
const handler = (overrides = {}) => createDestinationRecallHandler({ env: { TOKENHUB_API_KEY: 'test-secret', TOKENHUB_BASE_URL: 'https://tokenhub.test' }, createRequestId: () => 'recall_test', now: () => new Date('2026-08-09T00:00:00.000Z'), fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidates) } }] }), { status: 200 }), ...overrides });

test('validates exactly three role-differentiated candidates and enforces scope and day count', () => {
  assert.equal(validateRecallCandidates(candidates, constraints)?.length, 3);
  assert.equal(validateRecallCandidates([{ ...candidates[0], country: '日本' }, candidates[1], candidates[2]], constraints), null);
  assert.equal(validateRecallCandidates(candidates.map((item) => ({ ...item, outline: item.outline.slice(0, 1) })), constraints), null);
});

test('returns only validated recall candidates without exposing the upstream secret', async () => {
  let upstreamRequest;
  const response = await handler({ fetch: async (url, init) => { upstreamRequest = { url, init }; return new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(candidates)}\n\`\`\`` } }] }), { status: 200 }); } })(request({ input: '周末想去安静一点的海边走走。', profile, constraints }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.candidates.length, 3);
  assert.equal(payload.candidates[0].city, '东山岛');
  assert.match(upstreamRequest.url, /tokenhub\.tencentmaas\.com\/v1\/chat\/completions$/);
  assert.equal(upstreamRequest.init.headers.authorization, 'Bearer test-secret');
  assert.doesNotMatch(JSON.stringify(payload), /test-secret/);
});

test('rejects malformed requests and malformed model content safely', async () => {
  assert.equal((await handler()(new Request('https://example.test/api/destination-recall'))).status, 405);
  assert.equal((await handler()(request({ input: 'x', profile, constraints: { ...constraints, days: 5 } }))).status, 400);
  const invalid = await handler({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"nope":true}' } }] }), { status: 200 }) })(request({ input: '周末想去安静一点的海边走走。', profile, constraints }));
  assert.equal(invalid.status, 502);
  assert.equal((await invalid.json()).error.code, 'invalid_upstream_candidates');
});
