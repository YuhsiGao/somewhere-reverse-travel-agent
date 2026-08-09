import type { GeoPoint } from '../types';

export type PoiReference = {
  displayName: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  coordinate: GeoPoint;
  distanceMeters?: number;
  sourceUrl: string;
};

export type PoiReferenceVerification = {
  match: PoiReference;
  meta: { provider: 'openstreetmap-nominatim'; updatedAt: string; requestId: string };
};

export class PoiReferenceError extends Error {
  constructor() {
    super('地图参照暂时不可用；原有编辑行程未被修改。');
    this.name = 'PoiReferenceError';
  }
}

function coordinate(value: unknown): GeoPoint | undefined {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((point) => typeof point === 'number' && Number.isFinite(point))) return undefined;
  const [longitude, latitude] = value;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return undefined;
  return [longitude, latitude];
}

/** Validates the deliberately narrow, non-authoritative OSM reference contract. */
export function parsePoiReferenceVerification(value: unknown): PoiReferenceVerification | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const verification = value as { match?: unknown; meta?: unknown };
  if (!verification.match || !verification.meta || typeof verification.match !== 'object' || typeof verification.meta !== 'object') return undefined;
  const match = verification.match as Record<string, unknown>;
  const meta = verification.meta as Record<string, unknown>;
  const matchCoordinate = coordinate(match.coordinate);
  if (typeof match.displayName !== 'string' || !match.displayName.trim() || match.displayName.length > 300
    || !['node', 'way', 'relation'].includes(String(match.osmType))
    || (typeof match.osmId !== 'string' && typeof match.osmId !== 'number')
    || !matchCoordinate
    || typeof match.sourceUrl !== 'string' || !match.sourceUrl.startsWith('https://www.openstreetmap.org/')
    || meta.provider !== 'openstreetmap-nominatim'
    || typeof meta.updatedAt !== 'string' || Number.isNaN(Date.parse(meta.updatedAt))
    || typeof meta.requestId !== 'string' || !meta.requestId) return undefined;
  if (match.distanceMeters !== undefined && (typeof match.distanceMeters !== 'number' || !Number.isFinite(match.distanceMeters) || match.distanceMeters < 0)) return undefined;
  return {
    match: {
      displayName: match.displayName.trim(), osmType: match.osmType as PoiReference['osmType'], osmId: String(match.osmId), coordinate: matchCoordinate,
      ...(typeof match.distanceMeters === 'number' ? { distanceMeters: match.distanceMeters } : {}), sourceUrl: match.sourceUrl,
    },
    meta: { provider: 'openstreetmap-nominatim', updatedAt: meta.updatedAt, requestId: meta.requestId },
  };
}

export async function verifyPoiReference(name: string, coordinates: GeoPoint, fetcher: typeof fetch = globalThis.fetch): Promise<PoiReferenceVerification> {
  try {
    const response = await fetcher('/api/poi-verification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, coordinates }),
    });
    const value: unknown = await response.json().catch(() => null);
    const verification = response.ok ? parsePoiReferenceVerification(value) : undefined;
    if (!verification) throw new PoiReferenceError();
    return verification;
  } catch (error) {
    if (error instanceof PoiReferenceError) throw error;
    throw new PoiReferenceError();
  }
}
