/**
 * Privacy-minimal weather forecast proxy. It asks Open-Meteo only for the
 * daily fields needed by a selected itinerary date and never relays its raw
 * response to the browser.
 */
const MAX_BODY_BYTES = 2 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_CACHE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1_000;
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const makeRequestId = () => globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const failure = (status, code, message, meta, headers) => json(status, { error: { code, message }, meta: { mode: 'unavailable', ...meta } }, headers);

const readBody = async (request) => {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RangeError('body_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
};

const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
};
const validCoordinates = (value) => Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
  && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;

/** Strictly accept exactly `{ coordinates: [lng, lat], date: 'YYYY-MM-DD' }`. */
export const validateWeatherInput = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'coordinates') || !Object.hasOwn(value, 'date')) return null;
  if (!validCoordinates(value.coordinates) || !validDate(value.date)) return null;
  return { coordinates: [value.coordinates[0], value.coordinates[1]], date: value.date };
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
/** Reduce the upstream daily array to one selected date only. */
export const selectForecast = (raw, date) => {
  const daily = raw?.daily;
  if (!daily || typeof daily !== 'object' || Array.isArray(daily)) return null;
  const fields = ['time', 'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'wind_speed_10m_max'];
  if (!fields.every((field) => Array.isArray(daily[field]))) return null;
  const length = daily.time.length;
  if (length === 0 || !fields.every((field) => daily[field].length === length)) return null;
  const index = daily.time.indexOf(date);
  if (index < 0) return undefined;
  const values = [daily.weather_code[index], daily.temperature_2m_min[index], daily.temperature_2m_max[index], daily.precipitation_probability_max[index], daily.wind_speed_10m_max[index]];
  if (!values.every(finite)) return null;
  return {
    date,
    weatherCode: daily.weather_code[index],
    minC: daily.temperature_2m_min[index],
    maxC: daily.temperature_2m_max[index],
    precipitationProbabilityMax: daily.precipitation_probability_max[index],
    windSpeedMax: daily.wind_speed_10m_max[index],
  };
};

/** Creates a Fetch Request -> Response weather handler. Host owns CORS. */
export function createWeatherHandler(options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const nowMs = options.nowMs ?? Date.now;
  const createRequestId = options.createRequestId ?? makeRequestId;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const cacheTtlMs = Math.min(Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS), MAX_CACHE_TTL_MS);
  const cache = options.cache ?? new Map();
  return async function weather(request) {
    const meta = { requestId: createRequestId(), updatedAt: now().toISOString() };
    if (!(request instanceof Request)) return failure(500, 'invalid_request_runtime', '服务请求格式无效，请稍后重试。', meta);
    if (request.method !== 'POST') return failure(405, 'method_not_allowed', '仅支持 POST 请求。', meta, { allow: 'POST' });
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return failure(415, 'unsupported_media_type', '请求需使用 application/json。', meta);
    let parsed;
    try { parsed = JSON.parse(await readBody(request)); }
    catch (cause) { return cause instanceof RangeError ? failure(413, 'body_too_large', '请求内容不能超过 2KB。', meta) : failure(400, 'invalid_json', '请求 JSON 格式无效。', meta); }
    const input = validateWeatherInput(parsed);
    if (!input) return failure(400, 'invalid_input', '仅接受 coordinates [lng, lat] 与有效的 YYYY-MM-DD 日期。', meta);
    if (typeof fetchFn !== 'function') return failure(503, 'service_unavailable', '天气服务暂不可用，请稍后重试。', meta);
    const key = `${input.coordinates[0].toFixed(4)},${input.coordinates[1].toFixed(4)}|${input.date}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > nowMs()) return json(200, { forecast: cached.forecast, meta: { provider: 'open-meteo', updatedAt: meta.updatedAt, requestId: meta.requestId, cache: 'hit' } });
    const controller = new AbortController(); let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abortClient = () => controller.abort(); request.signal.addEventListener('abort', abortClient, { once: true });
    try {
      const [longitude, latitude] = input.coordinates;
      const url = new URL(OPEN_METEO_URL);
      url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max', timezone: 'auto', forecast_days: '16' }).toString();
      const upstream = await fetchFn(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!upstream.ok) return failure(502, 'upstream_rejected', '天气服务暂时无法完成请求，请稍后重试。', meta);
      let raw; try { raw = await upstream.json(); } catch { return failure(502, 'invalid_upstream_response', '天气服务返回了不可用结果，请稍后重试。', meta); }
      const forecast = selectForecast(raw, input.date);
      if (forecast === undefined) return failure(404, 'forecast_not_found', '所选日期不在当前天气预报范围内。', meta);
      if (!forecast) return failure(502, 'invalid_upstream_response', '天气服务返回了不可用结果，请稍后重试。', meta);
      cache.set(key, { forecast, expiresAt: nowMs() + cacheTtlMs });
      return json(200, { forecast, meta: { provider: 'open-meteo', updatedAt: meta.updatedAt, requestId: meta.requestId, cache: 'miss' } });
    } catch {
      if (timedOut) return failure(504, 'upstream_timeout', '天气查询超时，请稍后重试。', meta);
      if (request.signal.aborted) return failure(499, 'request_aborted', '请求已取消。', meta);
      return failure(502, 'upstream_unavailable', '天气服务暂不可用，请稍后重试。', meta);
    } finally { clearTimeout(timeout); request.signal.removeEventListener('abort', abortClient); }
  };
}

export const weather = createWeatherHandler();
