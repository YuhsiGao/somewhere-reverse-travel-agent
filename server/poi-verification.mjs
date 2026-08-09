import { createSharedRateGovernor } from './shared-rate-governor.mjs';

/**
 * Fetch-compatible, privacy-minimal OSM nearby-reference verifier.
 * It verifies only that Nominatim has a nearby geographic reference; it never
 * establishes that the returned object is the submitted POI or that it is open.
 */
const MAX_BODY_BYTES = 4 * 1024;
const MAX_NAME_LENGTH = 120;
const UPSTREAM_TIMEOUT_MS = 12_000;
const PUBLIC_NOMINATIM_INTERVAL_MS = 1_000;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

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

/** Accept a user-entered label and WGS84 [longitude, latitude], nothing else. */
export const validatePoiVerificationInput = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'name') || !Object.hasOwn(value, 'coordinates')) return null;
  if (!isNonEmptyString(value.name) || value.name.trim().length > MAX_NAME_LENGTH) return null;
  if (!Array.isArray(value.coordinates) || value.coordinates.length !== 2) return null;
  const [lng, lat] = value.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { name: value.name.trim(), coordinates: [lng, lat] };
};

const toRadians = (degrees) => degrees * (Math.PI / 180);
const distanceMeters = ([lngA, latA], [lngB, latB]) => {
  const latDelta = toRadians(latB - latA);
  const lngDelta = toRadians(lngB - lngA);
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/** Reduces Nominatim's response to a non-identifying nearby OSM reference. */
export const sanitizeNearbyReference = (value, requestedCoordinates) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { display_name: displayName, osm_type: osmType, osm_id: osmId } = value;
  const lat = Number(value.lat);
  const lng = Number(value.lon);
  if (!isNonEmptyString(displayName) || displayName.trim().length > 300) return null;
  if (!['node', 'way', 'relation'].includes(osmType) || !(Number.isSafeInteger(osmId) && osmId > 0)) return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  const coordinate = [lng, lat];
  return {
    reference: 'nearby_reference',
    displayName: displayName.trim(), osmType, osmId, coordinate,
    distanceMeters: distanceMeters(requestedCoordinates, coordinate),
    sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
  };
};

/** Creates a Request -> Response handler. CORS is intentionally owned by the host. */
export function createPoiVerificationHandler(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const makeId = options.createRequestId ?? createRequestId;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const nowMs = options.nowMs ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const referenceCache = options.referenceCache ?? new Map();
  const sharedGovernor = options.sharedGovernor ?? createSharedRateGovernor({ env });
  let nextPublicRequestAt = 0;
  const reservePublicRequest = async () => {
    const current = nowMs();
    const wait = Math.max(0, nextPublicRequestAt - current);
    nextPublicRequestAt = Math.max(nextPublicRequestAt, current) + PUBLIC_NOMINATIM_INTERVAL_MS;
    if (wait) await sleep(wait);
  };
  return async function poiVerification(request) {
    const meta = { requestId: makeId(), updatedAt: now().toISOString() };
    if (!(request instanceof Request)) return errorResponse(500, 'invalid_request_runtime', '服务请求格式无效，请稍后重试。', meta);
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', '仅支持 POST 请求。', meta, { allow: 'POST' });
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return errorResponse(415, 'unsupported_media_type', '请求需使用 application/json。', meta);
    let parsed;
    try { parsed = JSON.parse(await readBodyWithinLimit(request)); }
    catch (error) { return error instanceof RangeError ? errorResponse(413, 'body_too_large', '请求内容不能超过 4KB。', meta) : errorResponse(400, 'invalid_json', '请求 JSON 格式无效。', meta); }
    const input = validatePoiVerificationInput(parsed);
    if (!input) return errorResponse(400, 'invalid_input', '仅接受 name（不超过 120 字符）与 coordinates [lng, lat]。', meta);
    const userAgent = env.NOMINATIM_USER_AGENT;
    if (!isNonEmptyString(userAgent) || userAgent.length > 200 || /[\r\n]/.test(userAgent)) return errorResponse(503, 'service_not_configured', '地点参照服务暂未配置，请稍后重试。', meta);
    if (typeof fetchFn !== 'function') return errorResponse(503, 'service_unavailable', '地点参照服务暂不可用，请稍后重试。', meta);
    const cacheKey = `${input.coordinates[0].toFixed(6)},${input.coordinates[1].toFixed(6)}`;
    const cached = referenceCache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs()) {
      return jsonResponse(200, { match: cached.match, meta: { provider: 'openstreetmap-nominatim', updatedAt: meta.updatedAt, requestId: meta.requestId, cache: 'hit' } });
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abortFromClient = () => controller.abort();
    request.signal.addEventListener('abort', abortFromClient, { once: true });
    try {
      // The public endpoint permits at most one request/second per application.
      // Only explicit user clicks arrive here; repeated points use the cache above.
      const reservation = await sharedGovernor.reserve('nominatim', PUBLIC_NOMINATIM_INTERVAL_MS);
      if (reservation === 'denied') return errorResponse(429, 'public_rate_limited', '地点参照服务繁忙，请稍后重试。', meta, { 'retry-after': '1' });
      if (reservation === 'unavailable') return errorResponse(503, 'shared_governor_unavailable', '地点参照服务保护层暂不可用，请稍后重试。', meta);
      if (reservation === 'not-configured') await reservePublicRequest();
      const [lng, lat] = input.coordinates;
      const url = new URL(NOMINATIM_URL);
      url.search = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '0' }).toString();
      const upstream = await fetchFn(url, { headers: { accept: 'application/json', 'user-agent': userAgent }, signal: controller.signal });
      if (!upstream.ok) return errorResponse(502, 'upstream_rejected', '地点参照服务暂时无法完成请求，请稍后重试。', meta);
      let raw;
      try { raw = await upstream.json(); } catch { return errorResponse(502, 'invalid_upstream_response', '地点参照服务返回了不可用结果，请稍后重试。', meta); }
      const match = sanitizeNearbyReference(raw, input.coordinates);
      if (!match) return errorResponse(404, 'nearby_reference_not_found', '附近没有可用的地图参照，请稍后重试。', meta);
      referenceCache.set(cacheKey, { match, expiresAt: nowMs() + cacheTtlMs });
      return jsonResponse(200, { match, meta: { provider: 'openstreetmap-nominatim', updatedAt: meta.updatedAt, requestId: meta.requestId } });
    } catch {
      if (timedOut) return errorResponse(504, 'upstream_timeout', '地点参照查询超时，请稍后重试。', meta);
      if (request.signal.aborted) return errorResponse(499, 'request_aborted', '请求已取消。', meta);
      return errorResponse(502, 'upstream_unavailable', '地点参照服务暂不可用，请稍后重试。', meta);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abortFromClient);
    }
  };
}

export const poiVerification = createPoiVerificationHandler();
