import { describe, expect, it } from 'vitest';
import { destinations } from './data';
import { derivePreferenceProfile } from './services/preference-learning';
import { detectConditions, filterCatalogResults, getRoutePlanningState, itineraryForQuery, rerankCatalogResults, scoreCatalogMatch, scrollBehaviorFor, type CatalogQuery } from './App';

const baseQuery: CatalogQuery = {
  scope: 'any', days: 3, budget: 'flexible', departure: '上海', transport: 'rail', removedTags: [], refinements: [],
};

describe('editorial catalog query', () => {
  it('enforces scope, duration, and budget instead of falling back to unrelated places', () => {
    const domestic = filterCatalogResults('harbor', { ...baseQuery, scope: 'domestic', days: 2, budget: 'low' }, ['安静']);
    expect(domestic).toHaveLength(3);
    expect(domestic.every((place) => place.country === '中国' && place.tripDayOptions.includes(2))).toBe(true);

    const fourDayResult = filterCatalogResults('harbor', { ...baseQuery, scope: 'abroad', days: 4 }, ['安静']);
    expect(fourDayResult).toEqual([]);

    const lowBudgetAbroad = filterCatalogResults('harbor', { ...baseQuery, scope: 'abroad', budget: 'low' }, ['安静']);
    expect(lowBudgetAbroad).toEqual([]);
  });

  it('reranks catalog places when an active vibe tag is removed or a data-backed refinement is added', () => {
    const place = destinations.harbor[0];
    const withQuietTag = scoreCatalogMatch(place, ['安静', '步行'], []);
    const withoutQuietTag = scoreCatalogMatch(place, ['步行'], []);
    const quieter = scoreCatalogMatch(place, ['步行'], ['再安静一点']);

    expect(withoutQuietTag).not.toBe(withQuietTag);
    expect(quieter).not.toBe(withoutQuietTag);
    expect(scoreCatalogMatch(place, ['步行'], ['更温暖一些'])).toBe(withoutQuietTag);
  });

  it('applies local favourite preference only after hard filtering, explains it, and caps the final score', () => {
    const hardFiltered = filterCatalogResults('domestic', { ...baseQuery, scope: 'domestic', days: 2 }, ['安静']);
    const profile = derivePreferenceProfile([destinations.domestic[0]]);
    const ranked = rerankCatalogResults(hardFiltered, profile);
    const nearCap = { ...destinations.domestic[0], matchScore: 98 };
    const capped = rerankCatalogResults([nearCap], profile);

    expect(ranked).toHaveLength(hardFiltered.length);
    expect(ranked.every((place) => place.country === '中国' && place.tripDayOptions.includes(2))).toBe(true);
    expect(ranked[0].preferenceReason).toBeTruthy();
    expect(ranked[0].reasons[0]).toMatch(/^优先原因 · /);
    expect(capped[0]).toMatchObject({ matchScore: 99 });
  });

  it('uses only the itinerary already present in the catalog for route-plan readiness', () => {
    const plan = getRoutePlanningState(destinations.domestic[0], 2, 'rail');
    expect(plan).toMatchObject({ dayCount: 2, source: 'editorial-itinerary', routingStatus: 'not-connected', transportPreference: 'rail' });
    expect(plan.plannedPoiCount).toBeGreaterThan(0);
    expect(plan.plannedLegCount).toBeGreaterThan(0);
  });

  it('uses the exact requested itinerary variant and rejects incomplete four-day plans', () => {
    const fourDayPlan = itineraryForQuery(destinations.domestic[0], 4);
    const originalItinerary = destinations.domestic[0].itinerary;
    const plan = getRoutePlanningState(destinations.domestic[0], 4, 'drive');
    expect(fourDayPlan).toHaveLength(4);
    expect(plan).toMatchObject({ dayCount: 4, plannedPoiCount: 12, plannedLegCount: 8 });
    expect(destinations.domestic[0].itinerary).toBe(originalItinerary);
  });

  it('detects explicit constraints without applying them', () => {
    expect(detectConditions('从上海出发，国内住四天，想安静散步')).toEqual({ scope: 'domestic', days: 4, departure: '上海' });
    expect(detectConditions('北京出发，去海外玩 2 天')).toEqual({ scope: 'abroad', days: 2, departure: '北京' });
    expect(detectConditions('从上海自驾，国内三天，预算有限')).toEqual({ scope: 'domestic', days: 3, departure: '上海', transport: 'drive', budget: 'low' });
    expect(detectConditions('我想找一个安静的地方')).toEqual({});
  });

  it('uses instant programmatic scrolling when reduced motion is requested', () => {
    expect(scrollBehaviorFor(true)).toBe('auto');
    expect(scrollBehaviorFor(false)).toBe('smooth');
  });
});
