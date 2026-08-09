import type { GeoPoint } from '../types';

/** OSRM supports road-network profiles only; it is not a public-transit API. */
export type RoutableTravelMode = 'walk' | 'bike' | 'drive' | 'taxi';
export type RoutingMode = RoutableTravelMode | 'public-transit';
export type RouteStatus = 'ok' | 'unsupported' | 'invalid-input' | 'cancelled' | 'timeout' | 'no-route' | 'service-error' | 'invalid-response';

export type RouteGeometry = {
  type: 'LineString';
  coordinates: GeoPoint[];
};

export type RouteResult = {
  /** Identifies the service that supplied this result, including failed attempts. */
  source: 'osrm';
  status: RouteStatus;
  updatedAt: string;
  geometry: RouteGeometry | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  /** Safe, user-facing context. It never exposes a raw transport or JSON error. */
  message?: string;
};

export type RouteRequest = {
  coordinates: GeoPoint[];
  mode: RoutingMode;
  /** Allows a route request to be cancelled when its detail view is left. */
  signal?: AbortSignal;
};

export type RoutingClientOptions = {
  /** Defaults to the controlled same-origin route BFF; tests may inject direct OSRM. */
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
  /**
   * Optional cache boundary. Supply one per server/session when the default
   * browser-memory cache is not the desired isolation boundary.
   */
  cache?: RoutingMemoryCache;
};

export type RoutingMemoryCache = {
  get(key: string, atMs: number): RouteResult | undefined;
  set(key: string, value: RouteResult, atMs: number): void;
  getInFlight(key: string): InFlightRoute | undefined;
  setInFlight(key: string, value: InFlightRoute): void;
  deleteInFlight(key: string, value?: InFlightRoute): void;
  clear(): void;
};

export type RoutingMemoryCacheOptions = {
  /** Successful routes are deliberately short-lived; defaults to two minutes. */
  ttlMs?: number;
};

type InFlightRoute = {
  controller?: AbortController;
  consumers: number;
  promise: Promise<RouteResult>;
};

const PROFILE_BY_MODE: Record<RoutableTravelMode, 'walking' | 'cycling' | 'driving'> = {
  walk: 'walking',
  bike: 'cycling',
  drive: 'driving',
  taxi: 'driving',
};

const DEFAULT_BASE_URL = '/api/route';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CACHE_TTL_MS = 2 * 60_000;

/**
 * Creates an in-memory cache for successful OSRM results. The public OSRM
 * endpoint remains suitable for demo use only; production should inject a
 * cache alongside a proxied or self-hosted routing service.
 */
export function createRoutingMemoryCache(options: RoutingMemoryCacheOptions = {}): RoutingMemoryCache {
  const ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_CACHE_TTL_MS);
  const completed = new Map<string, { expiresAt: number; value: RouteResult }>();
  const inFlight = new Map<string, InFlightRoute>();

  return {
    get(key, atMs) {
      const entry = completed.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= atMs) {
        completed.delete(key);
        return undefined;
      }
      return copyRouteResult(entry.value);
    },
    set(key, value, atMs) {
      // Only classified successes ever reach this boundary.
      completed.set(key, { value: copyRouteResult(value), expiresAt: atMs + ttlMs });
    },
    getInFlight: (key) => inFlight.get(key),
    setInFlight: (key, value) => inFlight.set(key, value),
    deleteInFlight(key, value) {
      if (!value || inFlight.get(key) === value) inFlight.delete(key);
    },
    clear() {
      completed.clear();
      inFlight.clear();
    },
  };
}

const defaultRoutingCache = createRoutingMemoryCache();

/** Test/support API: clear the module's default browser-memory route cache. */
export function clearOsrmRouteCacheForTesting(): void {
  defaultRoutingCache.clear();
}

function emptyResult(status: RouteStatus, now: () => Date, message?: string): RouteResult {
  return { source: 'osrm', status, updatedAt: now().toISOString(), geometry: null, distanceKm: null, durationMinutes: null, message };
}

function copyRouteResult(result: RouteResult): RouteResult {
  return {
    ...result,
    geometry: result.geometry
      ? { type: 'LineString', coordinates: result.geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude]) }
      : null,
  };
}

function isGeoPoint(value: unknown): value is GeoPoint {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && typeof value[1] === 'number'
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function isLineString(value: unknown): value is RouteGeometry {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  return geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every(isGeoPoint);
}

function makeUrl(baseUrl: string, profile: string, coordinates: GeoPoint[]): string {
  const coordinatePath = coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`).join(';');
  const url = new URL(`/route/v1/${profile}/${coordinatePath}`, `${baseUrl.replace(/\/$/, '')}/`);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'false');
  return url.toString();
}

function isBffEndpoint(baseUrl: string): boolean {
  return baseUrl.startsWith('/');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError';
}

function cacheKey(baseUrl: string, mode: RoutingMode, coordinates: GeoPoint[]): string {
  // Keep the user-facing mode in the key: drive and taxi happen to use the
  // same OSRM profile today, but must never be treated as interchangeable.
  return `${baseUrl.replace(/\/$/, '')}|${mode}|${coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`).join(';')}`;
}

function awaitForConsumer(entry: InFlightRoute, signal: AbortSignal | undefined, now: () => Date): Promise<RouteResult> {
  entry.consumers += 1;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: RouteResult) => {
      if (settled) return;
      settled = true;
      entry.consumers -= 1;
      signal?.removeEventListener('abort', onAbort);
      if (entry.consumers === 0) entry.controller?.abort();
      resolve(result);
    };
    const onAbort = () => finish(emptyResult('cancelled', now, '路线查询已取消。'));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(finish);
  });
}

/**
 * Queries OSRM's documented `route/v1/{profile}/{coordinates}` endpoint.
 * Every outcome is returned as a classified result so UI callers never need
 * to turn transport/network exceptions into user-facing errors themselves.
 */
export async function getOsrmRoute(request: RouteRequest, options: RoutingClientOptions = {}): Promise<RouteResult> {
  const now = options.now ?? (() => new Date());
  if (request.mode === 'public-transit') return emptyResult('unsupported', now, 'OSRM 不提供公共交通路线。');
  const profile = PROFILE_BY_MODE[request.mode];
  if (request.signal?.aborted) return emptyResult('cancelled', now, '路线查询已取消。');
  if (request.coordinates.length < 2 || !request.coordinates.every(isGeoPoint)) return emptyResult('invalid-input', now, '请提供至少两个有效坐标。');

  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') return emptyResult('service-error', now, '当前环境无法发起路线查询。');

  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const cache = options.cache ?? defaultRoutingCache;
  const key = cacheKey(baseUrl, request.mode, request.coordinates);
  const cached = cache.get(key, now().getTime());
  if (cached) return cached;

  const existing = cache.getInFlight(key);
  if (existing && !existing.controller?.signal.aborted) return awaitForConsumer(existing, request.signal, now);

  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let entry!: InFlightRoute;
  const promise = (async (): Promise<RouteResult> => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timeoutId = controller && timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs) : undefined;

    try {
      const bffEndpoint = isBffEndpoint(baseUrl);
      const response = await fetcher(bffEndpoint ? baseUrl : makeUrl(baseUrl, profile, request.coordinates), bffEndpoint ? {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: request.mode, coordinates: request.coordinates }), signal: controller?.signal,
      } : {
        method: 'GET', headers: { Accept: 'application/json' }, signal: controller?.signal,
      });
    const payload: unknown = await response.json().catch(() => null);
    const body = payload as { code?: unknown; routes?: unknown; error?: { code?: unknown } } | null;

      if (body?.code === 'NoRoute' || body?.error?.code === 'no_route') return emptyResult('no-route', now, '这两个地点之间没有可用的道路路线。');
      if (!response.ok) return emptyResult('service-error', now, '路线服务暂时不可用。');
      const route = Array.isArray(body?.routes) ? body.routes[0] as { geometry?: unknown; distance?: unknown; duration?: unknown } | undefined : undefined;
      if ((!bffEndpoint && body?.code !== 'Ok') || !route || !isLineString(route.geometry) || typeof route.distance !== 'number' || !Number.isFinite(route.distance) || route.distance < 0 || typeof route.duration !== 'number' || !Number.isFinite(route.duration) || route.duration < 0) {
        return emptyResult('invalid-response', now, '路线服务返回的数据无法使用。');
      }
      return {
        source: 'osrm', status: 'ok', updatedAt: now().toISOString(), geometry: route.geometry,
        distanceKm: Math.round((route.distance / 1000) * 100) / 100,
        durationMinutes: Math.max(1, Math.round(route.duration / 60)),
      };
    } catch (error) {
      if (timedOut) return emptyResult('timeout', now, '路线查询超时，请稍后重试。');
      if (isAbortError(error)) return emptyResult('cancelled', now, '路线查询已取消。');
      return emptyResult('service-error', now, '路线服务暂时不可用。');
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  })();
  entry = { controller, consumers: 0, promise };
  cache.setInFlight(key, entry);
  promise.then((result) => {
    cache.deleteInFlight(key, entry);
    if (result.status === 'ok') cache.set(key, result, now().getTime());
  });
  return awaitForConsumer(entry, request.signal, now);
}
