import { describe, expect, it, vi } from 'vitest';
import { parsePoiReferenceVerification, PoiReferenceError, verifyPoiReference } from './poi-verification';

const valid = { match: { displayName: '示例地点', osmType: 'node', osmId: '42', coordinate: [120.1, 30.2], distanceMeters: 18, sourceUrl: 'https://www.openstreetmap.org/node/42' }, meta: { provider: 'openstreetmap-nominatim', updatedAt: '2026-08-04T00:00:00.000Z', requestId: 'request-1' } };

describe('poi reference client', () => {
  it('accepts only the narrow OSM reference contract', () => {
    expect(parsePoiReferenceVerification(valid)?.match.osmId).toBe('42');
    expect(parsePoiReferenceVerification({ ...valid, match: { ...valid.match, sourceUrl: 'https://example.com' } })).toBeUndefined();
  });

  it('posts only the requested POI name and coordinate, with safe failure', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => valid });
    await expect(verifyPoiReference('示例地点', [120.1, 30.2], fetcher)).resolves.toMatchObject({ match: { displayName: '示例地点' } });
    expect(fetcher).toHaveBeenCalledWith('/api/poi-verification', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '示例地点', coordinates: [120.1, 30.2] }) }));
    await expect(verifyPoiReference('示例地点', [120.1, 30.2], vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))).rejects.toBeInstanceOf(PoiReferenceError);
  });
});
