import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import { geometryFor } from './geography';

const allDestinations = Object.values(destinations).flat();

describe('static executable itinerary contract', () => {
  it('gives every current destination a complete, clearly-labelled daily POI plan', () => {
    allDestinations.forEach((destination) => {
      expect(destination.itinerary.length).toBeGreaterThanOrEqual(2);
      expect(destination.tripDayOptions).toEqual(expect.arrayContaining([2, 3, 4]));

      destination.itinerary.forEach((day) => {
        expect(day.dataStatus).toBe('static-editorial-demo');
        expect(day.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(day.pois.length).toBeGreaterThanOrEqual(3);
        expect(day.travelLegs).toHaveLength(day.pois.length - 1);

        day.pois.forEach((poi) => {
          expect(poi.name).not.toHaveLength(0);
          expect(poi.stayMinutes).toBeGreaterThan(0);
          expect(poi.whyItFits).not.toHaveLength(0);
          expect(poi.operatingRisk).toContain('实时');
          expect(poi.coordinates[0]).toBeGreaterThanOrEqual(-180);
          expect(poi.coordinates[0]).toBeLessThanOrEqual(180);
          expect(poi.coordinates[1]).toBeGreaterThanOrEqual(-90);
          expect(poi.coordinates[1]).toBeLessThanOrEqual(90);
          expect(poi.source.status).toBe('static-editorial-demo');
          expect(poi.source.label).toContain('静态编辑库');
          expect(poi.source.updatedAt).toBe(day.lastUpdated);
          expect(poi.source.note).toContain('示例');
        });

        day.travelLegs.forEach((leg, index) => {
          expect(leg.fromPoiId).toBe(day.pois[index].id);
          expect(leg.toPoiId).toBe(day.pois[index + 1].id);
          expect(leg.distanceKm).toBeGreaterThan(0);
          expect(leg.durationMinutes).toBeGreaterThan(0);
          expect(leg.navigationUrl).toMatch(/^https:\/\//);
        });
      });
    });
  });

  it('derives map geometry from itinerary POIs instead of a separate hard-coded polyline', () => {
    allDestinations.forEach((destination) => {
      const geometry = geometryFor(destination);
      expect(geometry.route).toEqual(destination.itinerary.flatMap((day) => day.pois.map((poi) => poi.coordinates)));
    });
  });

  it('provides complete 2-, 3-, and 4-day variants for the domestic MVP', () => {
    destinations.domestic.forEach((destination) => {
      const variants = destination.itineraryVariants;
      expect(variants).toBeDefined();
      ([2, 3, 4] as const).forEach((duration) => {
        const itinerary = variants?.[duration];
        expect(itinerary).toHaveLength(duration);
        itinerary?.forEach((day) => {
          expect(day.pois.length).toBeGreaterThanOrEqual(3);
          expect(day.travelLegs).toHaveLength(day.pois.length - 1);
        });
      });
    });
  });
});
