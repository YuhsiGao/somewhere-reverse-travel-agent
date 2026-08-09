import { describe, expect, it } from 'vitest';
import { discoverNearbyPois, parsePoiDiscovery } from './poi-discovery';

const valid = { places: [{ name: '示例公园', osmType: 'way', osmId: '88', coordinates: [120.1, 30.2], distanceKm: 1.2, sourceUrl: 'https://www.openstreetmap.org/way/88' }], meta: { provider: 'openstreetmap-nominatim', updatedAt: '2026-08-04T00:00:00.000Z', requestId: 'discover-1' } };

describe('nearby POI discovery client', () => {
  it('accepts only the minimal OSM discovery contract', () => {
    expect(parsePoiDiscovery(valid)).toMatchObject({ places: [{ name: '示例公园', osmId: '88' }] });
    expect(parsePoiDiscovery({ ...valid, places: [{ ...valid.places[0], sourceUrl: 'https://example.test/88' }] })).toBeUndefined();
    expect(parsePoiDiscovery({ ...valid, places: Array(6).fill(valid.places[0]) })).toBeUndefined();
    expect(parsePoiDiscovery({ ...valid, places: [{ ...valid.places[0], osmId: 88 }] })?.places[0].osmId).toBe('88');
    expect(parsePoiDiscovery({ ...valid, places: [{ ...valid.places[0], distanceKm: -1 }] })).toBeUndefined();
  });

  it('sends only a bounded category and coordinates to the controlled endpoint', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('/api/poi-discovery');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ coordinates: [120.1, 30.2], query: 'park' });
      return new Response(JSON.stringify(valid), { status: 200 });
    };
    await expect(discoverNearbyPois([120.1, 30.2], 'park', fetcher as typeof fetch)).resolves.toMatchObject({ places: [{ name: '示例公园' }] });
    await expect(discoverNearbyPois([120.1, 30.2], 'untrusted' as never, fetcher as typeof fetch)).rejects.toThrow('附近地图地点');
  });
});
