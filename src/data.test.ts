import { describe, expect, it } from 'vitest';
import { destinations, inspirations, vibes } from './data';

describe('demo travel data', () => {
  it('contains three differentiated destinations for every scenario', () => {
    Object.values(destinations).forEach((places) => {
      expect(places).toHaveLength(3);
      expect(new Set(places.map((place) => place.role)).size).toBe(3);
      places.forEach((place) => expect(place.reasons.length).toBeGreaterThanOrEqual(3));
    });
  });

  it('has three complete inspiration cases', () => {
    expect(inspirations.length).toBeGreaterThanOrEqual(3);
    inspirations.forEach((item) => expect(vibes[item.scenario].emotions.length).toBeGreaterThan(4));
  });

  it('uses canonical WGS84 coordinates for destination-level services', () => {
    const songyang = destinations.domestic.find((destination) => destination.id === 'songyang');
    expect(songyang?.coordinates).toEqual([119.486, 28.449]);
    Object.values(destinations).flat().forEach((destination) => {
      expect(destination.coordinates[0]).toBeGreaterThanOrEqual(-180);
      expect(destination.coordinates[0]).toBeLessThanOrEqual(180);
      expect(destination.coordinates[1]).toBeGreaterThanOrEqual(-90);
      expect(destination.coordinates[1]).toBeLessThanOrEqual(90);
    });
  });
});
