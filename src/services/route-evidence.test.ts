import { describe, expect, it } from 'vitest';
import { isRouteEvidenceFresh } from './route-evidence';

describe('route evidence', () => {
  const evidence = { provider: 'osrm' as const, checkedAt: '2026-08-04T12:00:00.000Z', distanceKm: 12.4, durationMinutes: 28, legCount: 2 };
  it('accepts only fresh, minimized route facts', () => {
    expect(isRouteEvidenceFresh(evidence, new Date('2026-08-04T12:14:59.000Z'))).toBe(true);
    expect(isRouteEvidenceFresh(evidence, new Date('2026-08-04T12:15:01.000Z'))).toBe(false);
    expect(isRouteEvidenceFresh({ ...evidence, legCount: 0 }, new Date('2026-08-04T12:01:00.000Z'))).toBe(false);
  });
});
