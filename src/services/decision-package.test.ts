import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import { buildDecisionPackageMarkdown, decisionPackageFilename } from './decision-package';

describe('decision package', () => {
  const destination = destinations.domestic[0];
  const itinerary = destination.itineraryVariants?.[3] ?? destination.itinerary;

  it('exports itinerary links and verification boundaries without a false live claim', () => {
    const markdown = buildDecisionPackageMarkdown({ destination, itinerary, routeStatus: { 1: 'verified', 2: 'failed' }, createdAt: new Date('2026-08-04T12:00:00.000Z') });
    expect(markdown).toContain('# 去处 Somewhere');
    expect(markdown).toContain('本次页面已生成道路路线');
    expect(markdown).toContain('路线未生成可用结果');
    expect(markdown).toContain(itinerary[0].pois[0].source.url);
    expect(markdown).toContain('不代表营业、预约、票务、价格、签证或安全状态');
    expect(markdown).not.toContain('已预订');
  });

  it('uses a readable date-stamped markdown filename', () => {
    expect(decisionPackageFilename(destination, new Date('2026-08-04T12:00:00.000Z'))).toBe(`somewhere-${destination.city}-2026-08-04-decision-package.md`);
  });

  it('includes only an explicit weather query and preserves its forecast boundary', () => {
    const markdown = buildDecisionPackageMarkdown({ destination, itinerary, weatherEvidence: { forecast: { date: '2026-08-04', weatherCode: 3, minC: 22, maxC: 31, precipitationProbabilityMax: 45, windSpeedMax: 18 }, checkedAt: '2026-08-04T11:55:00.000Z' }, createdAt: new Date('2026-08-04T12:00:00.000Z') });
    expect(markdown).toContain('已按需查询天气：2026-08-04 · 22–31°C');
    expect(markdown).toContain('来源 Open-Meteo');
    expect(markdown).toContain('不替代气象预警');
  });

  it('does not promote expired weather evidence as current verification', () => {
    const markdown = buildDecisionPackageMarkdown({ destination, itinerary, weatherEvidence: { forecast: { date: '2026-08-04', weatherCode: 3, minC: 22, maxC: 31, precipitationProbabilityMax: 45, windSpeedMax: 18 }, checkedAt: '2026-08-04T11:40:00.000Z' }, createdAt: new Date('2026-08-04T12:00:00.000Z') });
    expect(markdown).toContain('已超过 15 分钟有效窗口');
    expect(markdown).not.toContain('已按需查询天气：');
  });

  it('exports fresh road evidence with source and time, but marks stale evidence as expired', () => {
    const fresh = buildDecisionPackageMarkdown({ destination, itinerary, routeStatus: { 1: 'verified' }, routeEvidence: { 1: { provider: 'osrm', checkedAt: '2026-08-04T11:55:00.000Z', distanceKm: 12.4, durationMinutes: 28, legCount: 2 } }, createdAt: new Date('2026-08-04T12:00:00.000Z') });
    expect(fresh).toContain('道路核验证据：12.4 km · 约 28 分钟 · 2 段');
    expect(fresh).toContain('来源 OSRM 道路网络（演示）');
    const stale = buildDecisionPackageMarkdown({ destination, itinerary, routeEvidence: { 1: { provider: 'osrm', checkedAt: '2026-08-04T11:40:00.000Z', distanceKm: 12.4, durationMinutes: 28, legCount: 2 } }, createdAt: new Date('2026-08-04T12:00:00.000Z') });
    expect(stale).toContain('道路核验证据已超过 15 分钟有效窗口');
  });

  it('exports only fresh self-drive arrival evidence', () => {
    const markdown = buildDecisionPackageMarkdown({ destination, itinerary, arrivalEvidence: { provider: 'osrm', checkedAt: '2026-08-04T11:55:00.000Z', departure: '上海', transport: 'drive', distanceKm: 423.8, durationMinutes: 293 }, createdAt: new Date('2026-08-04T12:00:00.000Z') });
    expect(markdown).toContain('已按需核验自驾抵达：上海 → 松阳 · 423.8 km · 约 293 分钟');
    const stale = buildDecisionPackageMarkdown({ destination, itinerary, arrivalEvidence: { provider: 'osrm', checkedAt: '2026-08-04T11:40:00.000Z', departure: '上海', transport: 'drive', distanceKm: 423.8, durationMinutes: 293 }, createdAt: new Date('2026-08-04T12:00:00.000Z') });
    expect(stale).toContain('抵达段道路证据已超过 15 分钟有效窗口');
  });
});
