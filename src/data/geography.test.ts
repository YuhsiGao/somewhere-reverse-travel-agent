import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import { geometryFor } from './geography';

describe('destination geography', () => {
  it('provides map centers and route geometry derived from every destination itinerary', () => {
    Object.values(destinations).flat().forEach((place) => {
      const geometry = geometryFor(place);
      expect(geometry.center[0]).toBeGreaterThanOrEqual(-180);
      expect(geometry.center[0]).toBeLessThanOrEqual(180);
      expect(geometry.center[1]).toBeGreaterThanOrEqual(-90);
      expect(geometry.center[1]).toBeLessThanOrEqual(90);
      expect(geometry.route.length).toBeGreaterThanOrEqual(3);
    });
  });
});
