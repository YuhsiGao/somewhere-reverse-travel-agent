import { resolveTokenHubConnection } from './tokenhub-connection.mjs';

/** Platform-neutral TokenHub BFF core. It uses deployment env vars by default
 * and supports a bounded, request-scoped BYOK override. */
const MAX_BODY_BYTES = 20 * 1024;
const MIN_INPUT_LENGTH = 1;
const MAX_INPUT_LENGTH = 2000;
const UPSTREAM_TIMEOUT_MS = 12_000;

const jsonResponse = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
});

const createRequestId = () => globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const errorResponse = (status, code, message, meta, headers) => jsonResponse(status, {
  error: { code, message }, meta: { mode: 'unavailable', ...meta },
}, headers);

const concatChunks = (chunks, length) => {
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
};

const readBodyWithinLimit = async (request) => {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RangeError('body_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(concatChunks(chunks, length));
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/** Returns a sanitized profile or null; arbitrary model JSON never reaches clients. */
export const validateVibeProfile = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value;
  if (!isNonEmptyString(candidate.summary) || candidate.summary.trim().length > 500) return null;
  if (!Array.isArray(candidate.emotions) || candidate.emotions.length < 4 || candidate.emotions.length > 6) return null;
  const emotions = [];
  for (const emotion of candidate.emotions) {
    if (!emotion || typeof emotion !== 'object' || !isNonEmptyString(emotion.label) || emotion.label.trim().length > 30 || !Number.isInteger(emotion.score) || emotion.score < 0 || emotion.score > 100) return null;
    emotions.push({ label: emotion.label.trim(), score: emotion.score });
  }
  for (const key of ['environments', 'constraints']) {
    if (!Array.isArray(candidate[key]) || candidate[key].length > 12 || candidate[key].some((item) => !isNonEmptyString(item) || item.trim().length > 80)) return null;
  }
  if (!isNonEmptyString(candidate.pace) || !isNonEmptyString(candidate.socialDensity) || !isNonEmptyString(candidate.climate)) return null;
  return {
    summary: candidate.summary.trim(), emotions,
    environments: candidate.environments.map((item) => item.trim()),
    pace: candidate.pace.trim(), socialDensity: candidate.socialDensity.trim(), climate: candidate.climate.trim(),
    constraints: candidate.constraints.map((item) => item.trim()),
  };
};

const extractProfile = (raw) => {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const cleaned = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try { return validateVibeProfile(JSON.parse(cleaned)); } catch { return null; }
};

const makePrompt = (input) => `你是一名旅行氛围研究员。请把用户的模糊旅行愿望解析成 JSON，不要写 Markdown。用户输入：${input}\\n只返回以下结构：{"summary":"中文一句话","emotions":[{"label":"安静","score":88}],"environments":["海边"],"pace":"慢速","socialDensity":"独处为主","climate":"偏冷 · 潮湿","constraints":["3 天"]}。emotions 返回 4-6 项，score 为 0-100 整数；不要编造实时天气、价格或交通事实。`;

/** Creates a Request -> Response handler for any Fetch-compatible runtime. */
export function createTokenHubAgentHandler(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const makeId = options.createRequestId ?? createRequestId;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  return async function tokenHubAgent(request) {
    const meta = { requestId: makeId(), generatedAt: now().toISOString() };
    if (!(request instanceof Request)) return errorResponse(500, 'invalid_request_runtime', '服务请求格式无效，请稍后重试。', meta);
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', '仅支持 POST 请求。', meta, { allow: 'POST' });
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return errorResponse(415, 'unsupported_media_type', '请求需使用 application/json。', meta);
    let body;
    try { body = JSON.parse(await readBodyWithinLimit(request)); }
    catch (error) { return error instanceof RangeError ? errorResponse(413, 'body_too_large', '请求内容不能超过 20KB。', meta) : errorResponse(400, 'invalid_json', '请求 JSON 格式无效。', meta); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'input') || typeof body.input !== 'string') return errorResponse(400, 'invalid_input', '仅接受 JSON 字段 input。', meta);
    const input = body.input.trim();
    if (input.length < MIN_INPUT_LENGTH || input.length > MAX_INPUT_LENGTH) return errorResponse(400, 'invalid_input_length', 'input 必须为 1–2000 个字符。', meta);
    const connection = resolveTokenHubConnection(request, env, 'hy3');
    if (connection.error === 'invalid_gateway') return errorResponse(400, 'invalid_gateway', '仅支持 TokenHub 官方模型网关。', meta);
    if (connection.error === 'invalid_model') return errorResponse(400, 'invalid_model', '模型名称格式无效。', meta);
    if (connection.error === 'missing_key') return errorResponse(503, 'service_not_configured', '智能解析服务暂未配置，请稍后重试。', meta);
    if (typeof fetchFn !== 'function') return errorResponse(503, 'service_unavailable', '智能解析服务暂不可用，请稍后重试。', meta);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abortFromClient = () => controller.abort();
    request.signal.addEventListener('abort', abortFromClient, { once: true });
    try {
      const upstream = await fetchFn(`${connection.gateway}/v1/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${connection.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: connection.model, temperature: 0.2, messages: [{ role: 'user', content: makePrompt(input) }] }), signal: controller.signal,
      });
      if (!upstream.ok) return errorResponse(502, 'upstream_rejected', '智能解析服务暂时无法完成请求，请稍后重试。', meta);
      const profile = extractProfile(await upstream.text());
      if (!profile) return errorResponse(502, 'invalid_upstream_profile', '智能解析服务返回了不可用结果，请稍后重试。', meta);
      return jsonResponse(200, { profile, meta: { mode: 'live', ...meta, provider: 'tokenhub' } });
    } catch {
      if (timedOut) return errorResponse(504, 'upstream_timeout', '智能解析超时，请稍后重试。', meta);
      if (request.signal.aborted) return errorResponse(499, 'request_aborted', '请求已取消。', meta);
      return errorResponse(502, 'upstream_unavailable', '智能解析服务暂不可用，请稍后重试。', meta);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abortFromClient);
    }
  };
}

export const tokenHubAgent = createTokenHubAgentHandler();
