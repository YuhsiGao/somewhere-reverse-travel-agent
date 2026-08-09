import type { Destination } from '../types';
import { canonicalCoordinates } from '../data';

export type GeoPoint = [number, number];
export type PlaceGeometry = { center: GeoPoint; route: GeoPoint[] };

export function geometryFor(place: Destination): PlaceGeometry {
  const route = place.itinerary.flatMap((day) => day.pois.map((poi) => poi.coordinates));
  return { center: canonicalCoordinates[place.id] ?? route[0] ?? [0, 20], route };
}
