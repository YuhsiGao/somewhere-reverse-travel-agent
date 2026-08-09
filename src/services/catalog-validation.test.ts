import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import { validateCatalog } from './catalog-validation';

describe('catalog release gate', () => {
  it('accepts the shipped editorial catalog', () => expect(validateCatalog(Object.values(destinations).flat())).toEqual([]));
  it('rejects missing provenance and duplicate stable IDs', () => {
    const sample = structuredClone(Object.values(destinations).flat()[0]);
    sample.itinerary[0].pois[0].source.updatedAt = 'not-a-date';
    sample.itinerary[0].pois[0].operatingRisk = '';
    const conflicting = structuredClone(sample);
    conflicting.itinerary[0].pois[0].name = '同 ID 的另一地点';
    const issues = validateCatalog([sample, { ...sample }, conflicting]);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['duplicate_destination_id', 'duplicate_poi_id', 'invalid_updated_at', 'missing_risk']));
  });
});
