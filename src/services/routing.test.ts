import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOsrmRouteCacheForTesting, createRoutingMemoryCache, getOsrmRoute } from './routing';

const points: [[number, number], [number, number]] = [[121.4737, 31.2304], [121.4998, 31.2397]];
const now = () => new Date('2026-08-04T12:00:00.000Z');

function osrmResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  clearOsrmRouteCacheForTesting();
});

describe('getOsrmRoute', () => {
  it('uses OSRM route/v1 with the documented profile and GeoJSON full overview options', async () => {
    const fetcher = vi.fn().mockResolvedValue(osrmResponse({
      code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 2345, duration: 731 }],
    }));

    const result = await getOsrmRoute({ coordinates: points, mode: 'walk' }, { fetcher, now, baseUrl: 'https://osrm.example' });

    expect(fetcher).toHaveBeenCalledWith(
      'https://osrm.example/route/v1/walking/121.4737,31.2304;121.4998,31.2397?overview=full&geometries=geojson&steps=false',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toMatchObject({ source: 'osrm', status: 'ok', updatedAt: '2026-08-04T12:00:00.000Z', distanceKm: 2.35, durationMinutes: 12, geometry: { type: 'LineString', coordinates: points } });
  });

  it.each([
    ['bike', 'cycling'],
    ['drive', 'driving'],
    ['taxi', 'driving'],
  ] as const)('maps %s to OSRM %s', async (mode, profile) => {
    const fetcher = vi.fn().mockResolvedValue(osrmResponse({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 1, duration: 1 }] }));
    await getOsrmRoute({ coordinates: points, mode }, { fetcher, now, baseUrl: 'https://osrm.example' });
    expect(String(fetcher.mock.calls[0][0])).toContain(`/route/v1/${profile}/`);
  });

  it('does not call OSRM for public transit or invalid coordinates', async () => {
    const fetcher = vi.fn();
    await expect(getOsrmRoute({ coordinates: points, mode: 'public-transit' }, { fetcher, now })).resolves.toMatchObject({ status: 'unsupported', geometry: null });
    await expect(getOsrmRoute({ coordinates: [[200, 0], [1, 1]], mode: 'drive' }, { fetcher, now })).resolves.toMatchObject({ status: 'invalid-input', geometry: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies no-route, invalid responses, and ordinary fetch failures without throwing', async () => {
    await expect(getOsrmRoute({ coordinates: points, mode: 'drive' }, { fetcher: vi.fn().mockResolvedValue(osrmResponse({ code: 'NoRoute' })), now })).resolves.toMatchObject({ status: 'no-route', geometry: null });
    await expect(getOsrmRoute({ coordinates: points, mode: 'drive' }, { fetcher: vi.fn().mockResolvedValue(osrmResponse({ code: 'Ok', routes: [{}] })), now })).resolves.toMatchObject({ status: 'invalid-response', geometry: null });
    await expect(getOsrmRoute({ coordinates: points, mode: 'drive' }, { fetcher: vi.fn().mockRejectedValue(new Error('network down')), now })).resolves.toMatchObject({ status: 'service-error', geometry: null });
  });

  it('returns cancelled for an already-aborted request and timeout for a timed-out fetch', async () => {
    const aborter = new AbortController();
    aborter.abort();
    await expect(getOsrmRoute({ coordinates: points, mode: 'bike', signal: aborter.signal }, { fetcher: vi.fn(), now })).resolves.toMatchObject({ status: 'cancelled' });

    vi.useFakeTimers();
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = getOsrmRoute({ coordinates: points, mode: 'bike' }, { fetcher, now, timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    await expect(pending).resolves.toMatchObject({ status: 'timeout', geometry: null });
  });

  it('caches only successful results for a short, injectable TTL and can be cleared', async () => {
    let clock = Date.parse('2026-08-04T12:00:00.000Z');
    const controlledNow = () => new Date(clock);
    const cache = createRoutingMemoryCache({ ttlMs: 100 });
    const fetcher = vi.fn().mockResolvedValue(osrmResponse({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 1, duration: 1 }] }));
    const request = { coordinates: points, mode: 'walk' as const };

    await getOsrmRoute(request, { fetcher, now: controlledNow, cache });
    await getOsrmRoute(request, { fetcher, now: controlledNow, cache });
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 100;
    await getOsrmRoute(request, { fetcher, now: controlledNow, cache });
    expect(fetcher).toHaveBeenCalledTimes(2);

    cache.clear();
    await getOsrmRoute(request, { fetcher, now: controlledNow, cache });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('exposes a resettable default cache for deterministic tests', async () => {
    const fetcher = vi.fn().mockResolvedValue(osrmResponse({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 1, duration: 1 }] }));
    const request = { coordinates: points, mode: 'bike' as const };
    await getOsrmRoute(request, { fetcher, now });
    await getOsrmRoute(request, { fetcher, now });
    expect(fetcher).toHaveBeenCalledTimes(1);

    clearOsrmRouteCacheForTesting();
    await getOsrmRoute(request, { fetcher, now });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('deduplicates identical in-flight requests while allowing each caller to receive the result', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    const cache = createRoutingMemoryCache();
    const request = { coordinates: points, mode: 'drive' as const };

    const first = getOsrmRoute(request, { fetcher, now, cache });
    const second = getOsrmRoute(request, { fetcher, now, cache });
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveResponse(osrmResponse({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 10, duration: 10 }] }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'ok' }),
      expect.objectContaining({ status: 'ok' }),
    ]);
  });

  it('does not cache failures or cancelled requests', async () => {
    const cache = createRoutingMemoryCache();
    const request = { coordinates: points, mode: 'drive' as const };
    const unavailable = vi.fn().mockResolvedValue(osrmResponse({ code: 'Error' }, false, 503));
    await getOsrmRoute(request, { fetcher: unavailable, now, cache });
    await getOsrmRoute(request, { fetcher: unavailable, now, cache });
    expect(unavailable).toHaveBeenCalledTimes(2);

    const aborter = new AbortController();
    const abortingFetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const cancelled = getOsrmRoute({ ...request, signal: aborter.signal }, { fetcher: abortingFetcher, now, cache });
    aborter.abort();
    await expect(cancelled).resolves.toMatchObject({ status: 'cancelled' });

    const succeedingFetcher = vi.fn().mockResolvedValue(osrmResponse({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 1, duration: 1 }] }));
    await getOsrmRoute(request, { fetcher: succeedingFetcher, now, cache });
    expect(succeedingFetcher).toHaveBeenCalledTimes(1);
  });

  it('never reuses cached or in-flight routes across user-selected modes', async () => {
    let resolveWalk!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveWalk = resolve; }))
      .mockResolvedValue(osrmResponse({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 2, duration: 2 }] }));
    const cache = createRoutingMemoryCache();
    const walking = getOsrmRoute({ coordinates: points, mode: 'walk' }, { fetcher, now, cache });
    const driving = getOsrmRoute({ coordinates: points, mode: 'drive' }, { fetcher, now, cache });
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveWalk(osrmResponse({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 1, duration: 1 }] }));
    await Promise.all([walking, driving]);

    await getOsrmRoute({ coordinates: points, mode: 'taxi' }, { fetcher, now, cache });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
