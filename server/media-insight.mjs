import { resolveTokenHubConnection } from './tokenhub-connection.mjs';

/** Platform-neutral TokenHub image-insight BFF. The image is sent only to the configured upstream and is never persisted or returned. */
const MAX_BODY_BYTES = Math.floor(1.5 * 1024 * 1024);
const MAX_DESCRIPTION_LENGTH = 1000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PRIVATE_HOST_PATTERN = /^(?:localhost|.+\.local)$/i;

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

const decodeBase64 = (base64) => {
  try {
    if (typeof globalThis.atob === 'function') return Uint8Array.from(globalThis.atob(base64), (char) => char.charCodeAt(0));
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch { /* invalid base64 is rejected below */ }
  return null;
};

const hasImageSignature = (mimeType, bytes) => {
  if (!bytes) return false;
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
};

/** Strictly accepts a base64 JPEG, PNG or WebP data URL. No arbitrary URL can reach the upstream. */
export const validateImageDataUrl = (value) => {
  if (typeof value !== 'string' || value.length < 32) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || !ALLOWED_IMAGE_MIME_TYPES.has(match[1].toLowerCase())) return null;
  const base64 = match[2];
  if (base64.length % 4 !== 0 || /=/.test(base64.slice(0, -2))) return null;
  const mimeType = match[1].toLowerCase();
  if (!hasImageSignature(mimeType, decodeBase64(base64))) return null;
  return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType };
};

/** The browser never asks this service to download a URL. We only relay an
 * explicit, public HTTPS image URL to the vision provider after rejecting
 * obvious loopback/private targets and credential-bearing URLs. */
export const validatePublicImageUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || PRIVATE_HOST_PATTERN.test(url.hostname)) return null;
    const parts = url.hostname.split('.');
    if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
      const [a, b] = parts.map(Number);
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null;
    }
    if (url.hostname === '::1' || url.hostname.startsWith('fc') || url.hostname.startsWith('fd')) return null;
    return url.toString();
  } catch { return null; }
};

/** Returns a bounded, presentation-safe image insight or null. The upstream object is never returned directly. */
export const validateMediaInsight = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value;
  if (!isNonEmptyString(candidate.summary) || candidate.summary.trim().length > 240) return null;
  if (!Array.isArray(candidate.tags) || candidate.tags.length < 3 || candidate.tags.length > 6) return null;
  const tags = [];
  const seen = new Set();
  for (const tag of candidate.tags) {
    if (!isNonEmptyString(tag) || tag.trim().length > 30) return null;
    const normalized = tag.trim();
    if (seen.has(normalized)) return null;
    seen.add(normalized);
    tags.push(normalized);
  }
  return { summary: candidate.summary.trim(), tags };
};

const extractInsight = (raw) => {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const cleaned = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try { return validateMediaInsight(JSON.parse(cleaned)); } catch { return null; }
};

const makePrompt = (description) => `你是旅行灵感助手。根据用户明确授权的图片提取旅行氛围灵感。只返回 JSON，不要 Markdown：{"summary":"一句中文旅行氛围总结","tags":["标签一","标签二","标签三"]}。summary 不超过 240 字；tags 返回 3-6 个短中文标签，不要猜测人物身份、精确地点、实时营业/天气/价格或任何敏感属性。${description ? `用户补充：${description}` : '用户未提供文字补充。'}`;

/** Creates a Request -> Response handler for any Fetch-compatible server runtime. */
export function createMediaInsightHandler(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const makeId = options.createRequestId ?? createRequestId;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  return async function mediaInsight(request) {
    const meta = { requestId: makeId(), generatedAt: now().toISOString() };
    if (!(request instanceof Request)) return errorResponse(500, 'invalid_request_runtime', '服务请求格式无效，请稍后重试。', meta);
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', '仅支持 POST 请求。', meta, { allow: 'POST' });
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return errorResponse(415, 'unsupported_media_type', '请求需使用 application/json。', meta);
    let body;
    try { body = JSON.parse(await readBodyWithinLimit(request)); }
    catch (error) { return error instanceof RangeError ? errorResponse(413, 'body_too_large', '请求内容不能超过 1.5MB。', meta) : errorResponse(400, 'invalid_json', '请求 JSON 格式无效。', meta); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'imageDataUrl' && key !== 'imageUrl' && key !== 'description')) return errorResponse(400, 'invalid_input', '仅接受一张图片与可选 description。', meta);
    const hasDataUrl = body.imageDataUrl !== undefined;
    const hasPublicUrl = body.imageUrl !== undefined;
    if (hasDataUrl === hasPublicUrl) return errorResponse(400, 'invalid_input', '请提供一张图片。', meta);
    const image = hasDataUrl ? validateImageDataUrl(body.imageDataUrl) : validatePublicImageUrl(body.imageUrl);
    if (!image) return errorResponse(400, hasDataUrl ? 'invalid_image_data_url' : 'invalid_image_url', hasDataUrl ? '仅支持 JPG、PNG 或 WebP 的 base64 图片。' : '仅支持可公开访问的 HTTPS 图片链接。', meta);
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.trim().length > MAX_DESCRIPTION_LENGTH)) return errorResponse(400, 'invalid_description', 'description 必须是不超过 1000 字符的文本。', meta);
    const visionEnv = { ...env, TOKENHUB_MODEL: env.TOKENHUB_MEDIA_MODEL || env.TOKENHUB_MODEL };
    const connection = resolveTokenHubConnection(request, visionEnv, 'youtu-vita');
    if (connection.error === 'invalid_gateway') return errorResponse(400, 'invalid_gateway', '仅支持 TokenHub 官方模型网关。', meta);
    if (connection.error === 'invalid_model') return errorResponse(400, 'invalid_model', '模型名称格式无效。', meta);
    if (connection.error === 'missing_key') return errorResponse(503, 'service_not_configured', '图片灵感服务暂未配置，请稍后重试。', meta);
    if (typeof fetchFn !== 'function') return errorResponse(503, 'service_unavailable', '图片灵感服务暂不可用，请稍后重试。', meta);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abortFromClient = () => controller.abort();
    request.signal.addEventListener('abort', abortFromClient, { once: true });
    try {
      const upstream = await fetchFn(`${connection.gateway}/v1/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${connection.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: connection.model, temperature: 0.2, max_tokens: 360, messages: [{ role: 'user', content: [{ type: 'text', text: makePrompt(body.description?.trim()) }, { type: 'image_url', image_url: { url: typeof image === 'string' ? image : image.dataUrl } }] }] }), signal: controller.signal,
      });
      if (!upstream.ok) return errorResponse(502, 'upstream_rejected', '图片灵感服务暂时无法完成请求，请稍后重试。', meta);
      const insight = extractInsight(await upstream.text());
      if (!insight) return errorResponse(502, 'invalid_upstream_insight', '图片灵感服务返回了不可用结果，请稍后重试。', meta);
      return jsonResponse(200, { insight, meta: { mode: 'live', ...meta, provider: 'tokenhub' } });
    } catch {
      if (timedOut) return errorResponse(504, 'upstream_timeout', '图片灵感解析超时，请稍后重试。', meta);
      if (request.signal.aborted) return errorResponse(499, 'request_aborted', '请求已取消。', meta);
      return errorResponse(502, 'upstream_unavailable', '图片灵感服务暂不可用，请稍后重试。', meta);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abortFromClient);
    }
  };
}

export const mediaInsight = createMediaInsightHandler();
