import { resolveTokenHubConnection } from './tokenhub-connection.mjs';

/**
 * Purpose-built BFF for dynamic destination recall. It returns a deliberately
 * small, validated proposal surface: the model can suggest places, but cannot
 * pass arbitrary text or tool claims through to the browser.
 */
const MAX_BODY_BYTES = 24 * 1024;
const MAX_INPUT_LENGTH = 2_000;
// Recall needs to return three candidates plus a multi-day outline. TokenHub's
// first token can be slower than the short intent-classification endpoint, so
// give this user-visible, cancellable request its own bounded budget.
const UPSTREAM_TIMEOUT_MS = 30_000;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `recall_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const validString = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const trim = (value) => value.trim();

async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RangeError('too_large');
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validOutline(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return null;
  const outline = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !validString(item.theme, 40) || !validString(item.intro, 140) || !validString(item.anchor, 60)) return null;
    outline.push({ theme: trim(item.theme), intro: trim(item.intro), anchor: trim(item.anchor) });
  }
  return outline;
}

export function validateRecallCandidates(value, { scope, days } = {}) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const usedIds = new Set();
  const usedRoles = new Set();
  const candidates = [];
  for (const item of value) {
    if (!item || typeof item !== 'object'
      || !validString(item.city, 60) || !validString(item.region, 80) || !validString(item.country, 60)
      || !['best-match', 'unexpected', 'easy-to-reach'].includes(item.role)
      || !validString(item.tagline, 100) || !Array.isArray(item.atmosphere) || item.atmosphere.length < 2 || item.atmosphere.length > 6
      || item.atmosphere.some((tag) => !validString(tag, 30))
      || !Array.isArray(item.reasons) || item.reasons.length < 2 || item.reasons.length > 3 || item.reasons.some((reason) => !validString(reason, 110))
      || !validString(item.tradeoff, 120) || !validString(item.budgetNote, 80) || !validString(item.alternative, 90)
      || !Array.isArray(item.coordinates) || item.coordinates.length !== 2 || item.coordinates.some((number) => typeof number !== 'number' || !Number.isFinite(number))
    ) return null;
    const [longitude, latitude] = item.coordinates;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    if (scope === 'domestic' && trim(item.country) !== '中国') return null;
    if (scope === 'abroad' && trim(item.country) === '中国') return null;
    const outline = validOutline(item.outline);
    if (!outline || (days && outline.length !== days)) return null;
    const id = `${trim(item.country)}-${trim(item.city)}-${item.role}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-');
    if (usedIds.has(id) || usedRoles.has(item.role)) return null;
    usedIds.add(id); usedRoles.add(item.role);
    candidates.push({
      id, city: trim(item.city), region: trim(item.region), country: trim(item.country), role: item.role,
      tagline: trim(item.tagline), atmosphere: item.atmosphere.map(trim), reasons: item.reasons.map(trim), tradeoff: trim(item.tradeoff),
      budgetNote: trim(item.budgetNote), alternative: trim(item.alternative), coordinates: [longitude, latitude], outline,
    });
  }
  return candidates;
}

function promptFor({ input, profile, constraints }) {
  const scope = constraints.scope === 'domestic' ? '只推荐中国境内' : constraints.scope === 'abroad' ? '只推荐中国境外' : '国内外均可';
  return `旅行目的地召回。只输出紧凑 JSON 数组，不要 Markdown。\n委托：${input}\n氛围：${profile.summary}；${profile.emotions.map((item) => item.label).join('、')}；${profile.environments.join('、')}\n条件：${scope}；${constraints.days} 天；预算 ${constraints.budget}；出发地 ${constraints.departure}；交通 ${constraints.transport}。\n返回 3 个真实、不同目的地；role 各一次：best-match、unexpected、easy-to-reach。不得声称已核验价格/天气/交通/营业/签证/安全。coordinates 为城市中心大致 WGS84 [经度,纬度]。每个字符串尽量不超过 28 个中文字符；reasons 恰好 2 条；outline 恰好 ${constraints.days} 条，每条为体验锚点而非已核验 POI。\n结构：[{"city":"","region":"","country":"","role":"best-match","tagline":"","atmosphere":["",""],"reasons":["",""],"tradeoff":"","budgetNote":"","alternative":"","coordinates":[0,0],"outline":[{"theme":"","intro":"","anchor":""}]}]`;
}

function extract(raw, constraints) {
  let upstream;
  try { upstream = JSON.parse(raw); } catch { return null; }
  const content = upstream?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const clean = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try { return validateRecallCandidates(JSON.parse(clean), constraints); } catch { return null; }
}

export function createDestinationRecallHandler(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const requestId = options.createRequestId ?? makeId;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  return async function recall(request) {
    const meta = { requestId: requestId(), generatedAt: now().toISOString() };
    const fail = (status, code, message, headers) => json(status, { error: { code, message }, meta: { mode: 'unavailable', ...meta } }, headers);
    if (!(request instanceof Request)) return fail(500, 'invalid_request_runtime', '服务请求格式无效，请稍后重试。');
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', '仅支持 POST 请求。', { allow: 'POST' });
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return fail(415, 'unsupported_media_type', '请求需使用 application/json。');
    let body;
    try { body = await readJson(request); } catch (error) { return error instanceof RangeError ? fail(413, 'body_too_large', '请求内容不能超过 24KB。') : fail(400, 'invalid_json', '请求 JSON 格式无效。'); }
    const constraints = body?.constraints;
    if (!body || typeof body !== 'object' || !validString(body.input, MAX_INPUT_LENGTH) || !body.profile || typeof body.profile !== 'object'
      || !constraints || !['any', 'domestic', 'abroad'].includes(constraints.scope) || ![2, 3, 4].includes(constraints.days)
      || !['flexible', 'low', 'medium'].includes(constraints.budget) || !validString(constraints.departure, 40) || !validString(constraints.transport, 40)) return fail(400, 'invalid_input', '目的地召回请求格式无效。');
    const connection = resolveTokenHubConnection(request, env, 'hy3');
    if (connection.error === 'invalid_gateway') return fail(400, 'invalid_gateway', '仅支持 TokenHub 官方模型网关。');
    if (connection.error === 'invalid_model') return fail(400, 'invalid_model', '模型名称格式无效。');
    if (connection.error === 'missing_key' || typeof fetchFn !== 'function') return fail(503, 'service_not_configured', '智能召回服务暂未配置，请稍后重试。');
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      const upstream = await fetchFn(`${connection.gateway}/v1/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${connection.apiKey}`, 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model: connection.model, temperature: 0.25, max_tokens: 1400, messages: [{ role: 'user', content: promptFor(body) }] }),
      });
      if (!upstream.ok) return fail(502, 'upstream_rejected', '智能召回服务暂时无法完成请求，请稍后重试。');
      const candidates = extract(await upstream.text(), constraints);
      if (!candidates) return fail(502, 'invalid_upstream_candidates', '智能召回结果不完整，请重新尝试。');
      return json(200, { candidates, meta: { mode: 'live', provider: 'tokenhub', ...meta } });
    } catch {
      if (timedOut) return fail(504, 'upstream_timeout', '智能召回超时，请稍后重试。');
      if (request.signal.aborted) return fail(499, 'request_aborted', '请求已取消。');
      return fail(502, 'upstream_unavailable', '智能召回服务暂不可用，请稍后重试。');
    } finally { clearTimeout(timeout); request.signal.removeEventListener('abort', abort); }
  };
}

export const destinationRecall = createDestinationRecallHandler();
