import type { DayPlan, Destination, TravelPoi } from '../types';

export type CatalogIssue = { code: 'duplicate_destination_id' | 'duplicate_poi_id' | 'invalid_coordinate' | 'missing_source' | 'invalid_updated_at' | 'missing_risk'; message: string; destinationId: string; poiId?: string };

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
const validPoint = ([longitude, latitude]: [number, number]) => Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;

/** Content-release gate for structured editorial records; it performs no network verification. */
export function validateCatalog(destinations: readonly Destination[]): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const ids = new Set<string>();
  const poiIds = new Map<string, string>();
  const inspectPoi = (destination: Destination, poi: TravelPoi) => {
    const scopedId = `${destination.id}\u0000${poi.id}`;
    const fingerprint = `${poi.name}\u0000${poi.coordinates.join(',')}`;
    // The same POI may intentionally appear in 2/3/4-day itinerary variants.
    // It is an error only when one destination reuses an ID for a different place.
    if (poiIds.has(scopedId) && poiIds.get(scopedId) !== fingerprint) issues.push({ code: 'duplicate_poi_id', destinationId: destination.id, poiId: poi.id, message: `POI ID 指向多个地点：${poi.id}` }); else poiIds.set(scopedId, fingerprint);
    if (!validPoint(poi.coordinates)) issues.push({ code: 'invalid_coordinate', destinationId: destination.id, poiId: poi.id, message: `POI 坐标无效：${poi.name}` });
    if (!poi.source.label.trim() || !/^https?:\/\//.test(poi.source.url)) issues.push({ code: 'missing_source', destinationId: destination.id, poiId: poi.id, message: `POI 缺少可公开来源：${poi.name}` });
    if (!validDate(poi.source.updatedAt)) issues.push({ code: 'invalid_updated_at', destinationId: destination.id, poiId: poi.id, message: `POI 更新时间无效：${poi.name}` });
    if (!poi.operatingRisk.trim()) issues.push({ code: 'missing_risk', destinationId: destination.id, poiId: poi.id, message: `POI 缺少风险提示：${poi.name}` });
  };
  for (const destination of destinations) {
    if (ids.has(destination.id)) issues.push({ code: 'duplicate_destination_id', destinationId: destination.id, message: `目的地 ID 重复：${destination.id}` }); else ids.add(destination.id);
    if (!validPoint(destination.coordinates)) issues.push({ code: 'invalid_coordinate', destinationId: destination.id, message: `目的地坐标无效：${destination.city}` });
    const plans: DayPlan[] = [...destination.itinerary, ...Object.values(destination.itineraryVariants ?? {}).flat()];
    plans.flatMap((day) => day.pois).forEach((poi) => inspectPoi(destination, poi));
  }
  return issues;
}
