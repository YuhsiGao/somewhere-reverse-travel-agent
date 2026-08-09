import { describe, expect, it } from 'vitest';
import { buildCatalogHealthReport } from './catalog-health';
import type { DayPlan, Destination, TravelPoi } from '../types';

function poi(name: string, updatedAt: string, operatingRisk = '请出发前确认营业与预约。'): TravelPoi {
  return { id: name, name, category: 'park', coordinates: [120, 30], stayMinutes: 30, whyItFits: '测试', operatingRisk, source: { label: `编辑来源 · ${name}`, url: `https://example.test/${name}`, status: 'static-editorial-demo', updatedAt, note: '静态示例' } };
}
function fixture(pois: TravelPoi[]): { destination: Destination; itinerary: DayPlan[] } {
  const itinerary: DayPlan[] = [{ day: 1, theme: '测试', intro: '测试', moments: [], pois, travelLegs: [], dataStatus: 'static-editorial-demo', lastUpdated: '2026-08-01' }];
  return { destination: { id: 'test', city: '测试城', region: '测试区', country: '中国', itinerary } as Destination, itinerary };
}

describe('buildCatalogHealthReport', () => {
  it('counts POIs, distinct evidence and transparent static risks', () => {
    const first = poi('甲', '2026-08-01');
    const duplicateSource = { ...poi('乙', '2026-08-04'), source: { ...first.source } };
    const { destination, itinerary } = fixture([first, duplicateSource]);
    const report = buildCatalogHealthReport(destination, itinerary, { now: new Date('2026-08-05T00:00:00Z'), staleAfterDays: 30 });
    expect(report).toMatchObject({ poiCount: 2, uniqueEvidenceSourceCount: 1, earliestUpdatedAt: '2026-08-01', latestUpdatedAt: '2026-08-01', highRiskCount: 2, freshness: 'current', dataLabel: '静态编辑示例，非实时数据' });
    expect(report.verificationSummary).toContain('需在出发前自行核验');
  });

  it('reports missing, invalid and stale dates without treating them as fresh', () => {
    const { destination, itinerary } = fixture([poi('缺失', ''), poi('无效', '2026-02-30'), poi('过期', '2026-01-01', '')]);
    const report = buildCatalogHealthReport(destination, itinerary, { now: new Date('2026-08-05T00:00:00Z'), staleAfterDays: 30 });
    expect(report).toMatchObject({ missingUpdatedAtCount: 1, invalidUpdatedAtCount: 1, earliestUpdatedAt: '2026-01-01', latestUpdatedAt: '2026-01-01', freshness: 'unknown', highRiskCount: 2 });
  });

  it('marks only complete, old editorial timestamps as stale and honours injected age thresholds', () => {
    const { destination, itinerary } = fixture([poi('旧', '2026-01-01')]);
    expect(buildCatalogHealthReport(destination, itinerary, { now: new Date('2026-01-20T00:00:00Z'), staleAfterDays: 10 }).freshness).toBe('stale');
    expect(buildCatalogHealthReport(destination, itinerary, { now: new Date('2026-01-20T00:00:00Z'), staleAfterDays: 30 }).freshness).toBe('current');
  });
});
