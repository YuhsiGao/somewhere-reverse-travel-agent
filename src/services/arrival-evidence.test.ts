import { describe, expect, it } from 'vitest';
import { isArrivalEvidenceFresh } from './arrival-evidence';

describe('arrival evidence', () => {
  const evidence = { provider: 'osrm' as const, checkedAt: '2026-08-04T12:00:00.000Z', departure: '上海', transport: 'drive' as const, distanceKm: 423.8, durationMinutes: 293 };
  it('keeps only a fresh, minimized self-drive arrival fact', () => {
    expect(isArrivalEvidenceFresh(evidence, new Date('2026-08-04T12:05:00.000Z'))).toBe(true);
    expect(isArrivalEvidenceFresh({ ...evidence, transport: 'rail' as never }, new Date('2026-08-04T12:05:00.000Z'))).toBe(false);
    expect(isArrivalEvidenceFresh(evidence, new Date('2026-08-04T12:16:00.000Z'))).toBe(false);
  });
});
