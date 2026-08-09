import type { GeoPoint } from '../types';
import { apiUrl } from './api-url';

export const POI_DISCOVERY_CATEGORIES = ['park', 'cafe', 'museum', 'viewpoint'] as const;
export type PoiDiscoveryCategory = (typeof POI_DISCOVERY_CATEGORIES)[number];

export type DiscoveredPoi = {
  name: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  coordinates: GeoPoint;
  distanceKm: number;
  sourceUrl: string;
};

export type PoiDiscovery = {
  places: DiscoveredPoi[];
  meta: { provider: 'openstreetmap-nominatim'; updatedAt: string; requestId: string };
};

export class PoiDiscoveryError extends Error {
  constructor() { super('附近地图地点暂时不可用，请稍后重试或使用地图外链。'); this.name = 'PoiDiscoveryError'; }
}

const isPoint = (value: unknown): value is GeoPoint => Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
  && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
const validCategory = (value: unknown): value is PoiDiscoveryCategory => typeof value === 'string' && (POI_DISCOVERY_CATEGORIES as readonly string[]).includes(value);

export function parsePoiDiscovery(value: unknown): PoiDiscovery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const payload = value as { places?: unknown; meta?: unknown };
  if (!Array.isArray(payload.places) || payload.places.length > 5 || !payload.meta || typeof payload.meta !== 'object') return undefined;
  const meta = payload.meta as Record<string, unknown>;
  if (meta.provider !== 'openstreetmap-nominatim' || typeof meta.updatedAt !== 'string' || Number.isNaN(Date.parse(meta.updatedAt)) || typeof meta.requestId !== 'string' || !meta.requestId) return undefined;
  const places: DiscoveredPoi[] = [];
  for (const raw of payload.places) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const place = raw as Record<string, unknown>;
    const osmId = typeof place.osmId === 'string' || typeof place.osmId === 'number' ? String(place.osmId) : '';
    if (typeof place.name !== 'string' || !place.name.trim() || place.name.length > 240
      || !['node', 'way', 'relation'].includes(String(place.osmType)) || !osmId
      || !isPoint(place.coordinates) || typeof place.distanceKm !== 'number' || !Number.isFinite(place.distanceKm) || place.distanceKm < 0 || place.distanceKm > 100
      || typeof place.sourceUrl !== 'string' || !place.sourceUrl.startsWith('https://www.openstreetmap.org/')) return undefined;
    places.push({ name: place.name, osmType: place.osmType as DiscoveredPoi['osmType'], osmId, coordinates: place.coordinates, distanceKm: place.distanceKm, sourceUrl: place.sourceUrl });
  }
  return { places, meta: { provider: 'openstreetmap-nominatim', updatedAt: meta.updatedAt, requestId: meta.requestId } };
}

export async function discoverNearbyPois(coordinates: GeoPoint, query: PoiDiscoveryCategory, fetcher: typeof fetch = globalThis.fetch): Promise<PoiDiscovery> {
  if (!isPoint(coordinates) || !validCategory(query)) throw new PoiDiscoveryError();
  try {
    const response = await fetcher(apiUrl('/api/poi-discovery'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates, query }) });
    const value: unknown = await response.json().catch(() => null);
    const parsed = response.ok ? parsePoiDiscovery(value) : undefined;
    if (!parsed) throw new PoiDiscoveryError();
    return parsed;
  } catch (error) {
    if (error instanceof PoiDiscoveryError) throw error;
    throw new PoiDiscoveryError();
  }
}
