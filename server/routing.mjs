import { createSharedRateGovernor } from './shared-rate-governor.mjs';

/**
 * Fetch-compatible OSRM route proxy. It accepts only an allow-listed route
 * request and deliberately preserves OSRM's small route shape so a browser
 * client can replace the public endpoint with this BFF without data changes.
 */
const MAX_BODY_BYTES = 8 * 1024;
const MAX_COORDINATES = 12;
const UPSTREAM_TIMEOUT_MS = 12_000;
const PUBLIC_OSRM_INTERVAL_MS = 1_000;
const DEFAULT_CACHE_TTL_MS = 2 * 60 * 1_000;
const PUBLIC_OSRM_URL = 'https://router.project-osrm.org';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const createRequestId = () => globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const error = (status, code, message, meta, headers) => json(status, { error: { code, message }, meta: { mode: 'unavailable', ...meta } }, headers);
const isPoint = (value) => Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
  && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;

const readBody = async (request) => {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RangeError('body_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
};

/** Strictly accept the documented wire contract; no profile or URL injection. */
export const validateRouteInput = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'mode') || !Object.hasOwn(value, 'coordinates')) return null;
  if (!['walk', 'bike', 'drive', 'taxi'].includes(value.mode)) return null;
  if (!Array.isArray(value.coordinates) || value.coordinates.length < 2 || value.coordinates.length > MAX_COORDINATES || !value.coordinates.every(isPoint)) return null;
  return { mode: value.mode, coordinates: value.coordinates.map(([lng, lat]) => [lng, lat]) };
};

const profileFor = (mode) => ({ walk: 'walking', bike: 'cycling', drive: 'driving', taxi: 'driving' })[mode];
const validRoute = (route) => route && typeof route === 'object' && Number.isFinite(route.distance) && route.distance >= 0
  && Number.isFinite(route.duration) && route.duration >= 0 && route.geometry && route.geometry.type === 'LineString'
  && Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length >= 2 && route.geometry.coordinates.every(isPoint);
const normalizedBaseUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value) ? value.replace(/\/$/, '') : PUBLIC_OSRM_URL;

/**
 * Returns `{ code: 'Ok', routes: [{ distance, duration, geometry:{type,coordinates} }] }`,
 * matching OSRM's route/v1 success shape, plus a safe meta object.
 */
export function createRoutingHandler(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const nowMs = options.nowMs ?? Date.now;
  const makeId = options.createRequestId ?? createRequestId;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = options.cache ?? new Map();
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const sharedGovernor = options.sharedGovernor ?? createSharedRateGovernor({ env });
  let nextPublicRequestAt = 0;
  return async function routing(request) {
    const meta = { requestId: makeId(), updatedAt: now().toISOString() };
    if (!(request instanceof Request)) return error(500, 'invalid_request_runtime', '服务请求格式无效，请稍后重试。', meta);
    if (request.method !== 'POST') return error(405, 'method_not_allowed', '仅支持 POST 请求。', meta, { allow: 'POST' });
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return error(415, 'unsupported_media_type', '请求需使用 application/json。', meta);
    let parsed;
    try { parsed = JSON.parse(await readBody(request)); }
    catch (cause) { return cause instanceof RangeError ? error(413, 'body_too_large', '请求内容不能超过 8KB。', meta) : error(400, 'invalid_json', '请求 JSON 格式无效。', meta); }
    const input = validateRouteInput(parsed);
    if (!input) return error(400, 'invalid_input', '仅接受 walk、bike、drive 或 taxi，以及 2 至 12 个有效坐标点。', meta);
    if (typeof fetchFn !== 'function') return error(503, 'service_unavailable', '路线服务暂不可用，请稍后重试。', meta);

    const baseUrl = normalizedBaseUrl(env.OSRM_URL);
    const key = `${baseUrl}|${input.mode}|${input.coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';')}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > nowMs()) return json(200, { code: 'Ok', routes: cached.routes, meta: { provider: 'osrm', updatedAt: meta.updatedAt, requestId: meta.requestId, cache: 'hit' } });

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abortClient = () => controller.abort();
    request.signal.addEventListener('abort', abortClient, { once: true });
    try {
      // Respect the public demo policy. Configured OSRM instances are assumed
      // to own their own capacity controls.
      if (baseUrl === PUBLIC_OSRM_URL) {
        const reservation = await sharedGovernor.reserve('osrm', PUBLIC_OSRM_INTERVAL_MS);
        if (reservation === 'denied') return error(429, 'public_rate_limited', '路线服务繁忙，请稍后重试。', meta, { 'retry-after': '1' });
        if (reservation === 'unavailable') return error(503, 'shared_governor_unavailable', '路线服务保护层暂不可用，请稍后重试。', meta);
        if (reservation === 'not-configured') {
          const current = nowMs();
          const wait = Math.max(0, nextPublicRequestAt - current);
          nextPublicRequestAt = Math.max(current, nextPublicRequestAt) + PUBLIC_OSRM_INTERVAL_MS;
          if (wait) await sleep(wait);
        }
      }
      const coordinates = input.coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
      const url = new URL(`/route/v1/${profileFor(input.mode)}/${coordinates}`, `${baseUrl}/`);
      url.search = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'false' }).toString();
      const upstream = await fetchFn(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!upstream.ok) return error(502, 'upstream_rejected', '路线服务暂时无法完成请求，请稍后重试。', meta);
      let body;
      try { body = await upstream.json(); } catch { return error(502, 'invalid_upstream_response', '路线服务返回了不可用结果，请稍后重试。', meta); }
      if (body?.code === 'NoRoute') return error(404, 'no_route', '这些地点之间没有可用的道路路线。', meta);
      const route = Array.isArray(body?.routes) ? body.routes[0] : null;
      if (body?.code !== 'Ok' || !validRoute(route)) return error(502, 'invalid_upstream_response', '路线服务返回了不可用结果，请稍后重试。', meta);
      const routes = [{ distance: route.distance, duration: route.duration, geometry: { type: 'LineString', coordinates: route.geometry.coordinates.map(([lng, lat]) => [lng, lat]) } }];
      cache.set(key, { routes, expiresAt: nowMs() + cacheTtlMs });
      return json(200, { code: 'Ok', routes, meta: { provider: 'osrm', updatedAt: meta.updatedAt, requestId: meta.requestId, cache: 'miss' } });
    } catch {
      if (timedOut) return error(504, 'upstream_timeout', '路线查询超时，请稍后重试。', meta);
      if (request.signal.aborted) return error(499, 'request_aborted', '请求已取消。', meta);
      return error(502, 'upstream_unavailable', '路线服务暂不可用，请稍后重试。', meta);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abortClient);
    }
  };
}

export const routing = createRoutingHandler();
