import { createSharedRateGovernor } from './shared-rate-governor.mjs';

/**
 * Fetch-compatible OSM POI discovery. This is deliberately a small, user
 * initiated discovery primitive, not a claim that an OSM result is current,
 * reviewed, open, or suitable for an itinerary.
 */
const MAX_BODY_BYTES = 4 * 1024;
const MAX_UPSTREAM_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;
const PUBLIC_NOMINATIM_INTERVAL_MS = 1_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1_000;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const ALLOWED_QUERIES = new Set(['park', 'cafe', 'museum', 'viewpoint']);

const jsonResponse = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
});
const createRequestId = () => globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const errorResponse = (status, code, message, meta, headers) => jsonResponse(status, { error: { code, message }, meta: { mode: 'unavailable', ...meta } }, headers);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const concatChunks = (chunks, length) => {
  const merged = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
};

const readStreamWithinLimit = async (stream, declaredLength, limit) => {
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new RangeError('too_large');
  if (!stream) return '';
  const reader = stream.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new RangeError('too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(concatChunks(chunks, length));
};

/** Accept exactly one supported category and a WGS84 [longitude, latitude]. */
export const validatePoiDiscoveryInput = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'query') || !Object.hasOwn(value, 'coordinates')) return null;
  if (typeof value.query !== 'string' || !ALLOWED_QUERIES.has(value.query)) return null;
  if (!Array.isArray(value.coordinates) || value.coordinates.length !== 2) return null;
  const [lng, lat] = value.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { query: value.query, coordinates: [lng, lat] };
};

/** Reduces a search item to the only fields needed by the client. */
export const sanitizeDiscoveredPoi = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = value.name || value.display_name;
  const type = value.type;
  const osmType = value.osm_type;
  const osmId = value.osm_id;
  const lng = Number(value.lon); const lat = Number(value.lat);
  if (!isNonEmptyString(name) || name.trim().length > 180 || !isNonEmptyString(type) || type.trim().length > 80) return null;
  if (!['node', 'way', 'relation'].includes(osmType) || !Number.isSafeInteger(osmId) || osmId <= 0) return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { name: name.trim(), type: type.trim(), osmType, osmId, coordinates: [lng, lat], sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}` };
};

/** Great-circle distance keeps nearby discovery interpretable without trusting a routing claim. */
export const distanceKmBetween = ([fromLng, fromLat], [toLng, toLat]) => {
  const radians = Math.PI / 180;
  const latDelta = (toLat - fromLat) * radians;
  const lngDelta = (toLng - fromLng) * radians;
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(fromLat * radians) * Math.cos(toLat * radians) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const boundedViewbox = ([lng, lat]) => {
  const latDelta = 0.08;
  const lngDelta = Math.min(0.16, latDelta / Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const west = Math.max(-180, lng - lngDelta); const east = Math.min(180, lng + lngDelta);
  const south = Math.max(-90, lat - latDelta); const north = Math.min(90, lat + latDelta);
  return `${west},${north},${east},${south}`;
};

/** Creates a Request -> Response handler. CORS is intentionally owned by the host. */
export function createPoiDiscoveryHandler(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date()); const nowMs = options.nowMs ?? Date.now;
  const makeId = options.createRequestId ?? createRequestId;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = options.cache ?? new Map(); let nextPublicRequestAt = 0;
  const sharedGovernor = options.sharedGovernor ?? createSharedRateGovernor({ env });
  const reservePublicRequest = async () => {
    const current = nowMs(); const wait = Math.max(0, nextPublicRequestAt - current);
    nextPublicRequestAt = Math.max(nextPublicRequestAt, current) + PUBLIC_NOMINATIM_INTERVAL_MS;
    if (wait) await sleep(wait);
  };
  return async function poiDiscovery(request) {
    const meta = { requestId: makeId(), updatedAt: now().toISOString() };
    if (!(request instanceof Request)) return errorResponse(500, 'invalid_request_runtime', '服务请求格式无效，请稍后重试。', meta);
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', '仅支持 POST 请求。', meta, { allow: 'POST' });
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return errorResponse(415, 'unsupported_media_type', '请求需使用 application/json。', meta);
    let parsed;
    try { parsed = JSON.parse(await readStreamWithinLimit(request.body, Number(request.headers.get('content-length')), MAX_BODY_BYTES)); }
    catch (error) { return error instanceof RangeError ? errorResponse(413, 'body_too_large', '请求内容不能超过 4KB。', meta) : errorResponse(400, 'invalid_json', '请求 JSON 格式无效。', meta); }
    const input = validatePoiDiscoveryInput(parsed);
    if (!input) return errorResponse(400, 'invalid_input', '仅接受 query（park、cafe、museum 或 viewpoint）与 coordinates [lng, lat]。', meta);
    const userAgent = env.NOMINATIM_USER_AGENT;
    if (!isNonEmptyString(userAgent) || userAgent.length > 200 || /[\r\n]/.test(userAgent)) return errorResponse(503, 'service_not_configured', '地点发现服务暂未配置，请稍后重试。', meta);
    if (typeof fetchFn !== 'function') return errorResponse(503, 'service_unavailable', '地点发现服务暂不可用，请稍后重试。', meta);
    const cacheKey = `${input.query}:${input.coordinates[0].toFixed(5)},${input.coordinates[1].toFixed(5)}`;
    const cached = cache.get(cacheKey);
    if (cached?.expiresAt > nowMs()) return jsonResponse(200, { places: cached.places, meta: { provider: 'openstreetmap-nominatim', updatedAt: meta.updatedAt, requestId: meta.requestId, cache: 'hit' } });
    const controller = new AbortController(); let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abortFromClient = () => controller.abort(); request.signal.addEventListener('abort', abortFromClient, { once: true });
    try {
      // Public Nominatim allows one request/second per application. Requests are
      // user initiated, cached, and bounded to a small nearby viewbox.
      const reservation = await sharedGovernor.reserve('nominatim', PUBLIC_NOMINATIM_INTERVAL_MS);
      if (reservation === 'denied') return errorResponse(429, 'public_rate_limited', '地点发现服务繁忙，请稍后重试。', meta, { 'retry-after': '1' });
      if (reservation === 'unavailable') return errorResponse(503, 'shared_governor_unavailable', '地点发现服务保护层暂不可用，请稍后重试。', meta);
      if (reservation === 'not-configured') await reservePublicRequest();
      const url = new URL(NOMINATIM_URL);
      url.search = new URLSearchParams({ q: input.query, format: 'jsonv2', limit: '5', bounded: '1', viewbox: boundedViewbox(input.coordinates), addressdetails: '0' }).toString();
      const upstream = await fetchFn(url, { headers: { accept: 'application/json', 'user-agent': userAgent }, signal: controller.signal });
      if (!upstream.ok) return errorResponse(502, 'upstream_rejected', '地点发现服务暂时无法完成请求，请稍后重试。', meta);
      let raw;
      try { raw = JSON.parse(await readStreamWithinLimit(upstream.body, Number(upstream.headers.get('content-length')), MAX_UPSTREAM_BYTES)); }
      catch (error) { return error instanceof RangeError ? errorResponse(502, 'upstream_response_too_large', '地点发现服务返回了不可用结果，请稍后重试。', meta) : errorResponse(502, 'invalid_upstream_response', '地点发现服务返回了不可用结果，请稍后重试。', meta); }
      if (!Array.isArray(raw)) return errorResponse(502, 'invalid_upstream_response', '地点发现服务返回了不可用结果，请稍后重试。', meta);
      const places = raw.map(sanitizeDiscoveredPoi).filter(Boolean)
        .map((place) => ({ ...place, distanceKm: Number(distanceKmBetween(input.coordinates, place.coordinates).toFixed(1)) }))
        .sort((left, right) => left.distanceKm - right.distanceKm)
        .slice(0, 5);
      cache.set(cacheKey, { places, expiresAt: nowMs() + cacheTtlMs });
      return jsonResponse(200, { places, meta: { provider: 'openstreetmap-nominatim', updatedAt: meta.updatedAt, requestId: meta.requestId } });
    } catch {
      if (timedOut) return errorResponse(504, 'upstream_timeout', '地点发现查询超时，请稍后重试。', meta);
      if (request.signal.aborted) return errorResponse(499, 'request_aborted', '请求已取消。', meta);
      return errorResponse(502, 'upstream_unavailable', '地点发现服务暂不可用，请稍后重试。', meta);
    } finally { clearTimeout(timeout); request.signal.removeEventListener('abort', abortFromClient); }
  };
}

export const poiDiscovery = createPoiDiscoveryHandler();
