import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import { accessiblePlaceItems, accessiblePoiItems, mapHealthCopy, poisForItinerary, routeFeaturesForItinerary, routeFeaturesForVerifiedLegs, routeVerificationProgressLabel, routeVerificationStatusForRoutingResult } from './JourneyMap';

describe('JourneyMap itinerary data', () => {
  const fourDayItinerary = destinations.domestic[0].itineraryVariants?.[4] ?? [];

  it('keeps every day and POI from the planner itinerary without a fixed day cap', () => {
    expect(fourDayItinerary).toHaveLength(4);
    expect(poisForItinerary(fourDayItinerary)).toHaveLength(
      fourDayItinerary.reduce((total, day) => total + day.pois.length, 0),
    );
    expect(new Set(poisForItinerary(fourDayItinerary).map((poi) => poi.day))).toEqual(new Set([1, 2, 3, 4]));
  });

  it('derives one route feature per available day from the supplied itinerary', () => {
    const routes = routeFeaturesForItinerary(fourDayItinerary);
    expect(routes).toHaveLength(4);
    expect(routes.map((route) => route.properties.day)).toEqual([1, 2, 3, 4]);
    routes.forEach((route, index) => {
      expect(route.geometry.coordinates).toEqual(fourDayItinerary[index].pois.map((poi) => poi.coordinates));
    });
  });

  it('only renders verified road geometry when a routing adapter explicitly returns it', () => {
    const leg = fourDayItinerary[0].travelLegs[0];
    const verified = routeFeaturesForVerifiedLegs([{ legId: leg.id, coordinates: [leg ? fourDayItinerary[0].pois[0].coordinates : [0, 0], fourDayItinerary[0].pois[1].coordinates] }]);
    expect(verified).toHaveLength(1);
    expect(verified[0].properties.legId).toBe(leg.id);
    expect(verified[0].geometry.coordinates).toHaveLength(2);
    expect(routeFeaturesForVerifiedLegs([])).toEqual([]);
  });

  it('creates one keyboard-equivalent map action for each candidate place', () => {
    const items = accessiblePlaceItems(destinations.domestic.slice(0, 2));
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual(destinations.domestic.slice(0, 2).map((place) => place.id));
    expect(items[0].label).toContain(destinations.domestic[0].city);
  });

  it('creates one keyboard-equivalent map action for every POI without a fixed day cap', () => {
    const items = accessiblePoiItems(fourDayItinerary);
    expect(items).toHaveLength(poisForItinerary(fourDayItinerary).length);
    expect(items.map((item) => item.id)).toEqual(poisForItinerary(fourDayItinerary).map((poi) => poi.id));
    expect(items.map((item) => item.label).join(' ')).toContain('第 4 天');
  });

  it('maps routing outcomes to the minimal host-safe verification states', () => {
    expect(routeVerificationStatusForRoutingResult('ok')).toBe('verified');
    expect(routeVerificationStatusForRoutingResult('no-route')).toBe('failed');
    expect(routeVerificationStatusForRoutingResult('invalid-response')).toBe('failed');
    expect(routeVerificationStatusForRoutingResult('unsupported')).toBe('unavailable');
    expect(routeVerificationStatusForRoutingResult('timeout')).toBe('unavailable');
    expect(routeVerificationStatusForRoutingResult('service-error')).toBe('unavailable');
    expect(routeVerificationStatusForRoutingResult('cancelled')).toBe('not-requested');
  });

  it('uses an honest visible status when the map base cannot load', () => {
    expect(mapHealthCopy('loading')).toContain('正在准备');
    expect(mapHealthCopy('ready')).toContain('可缩放');
    expect(mapHealthCopy('degraded')).toContain('地图暂不可用');
  });

  it('makes multi-leg routing progress explicit without exceeding the total', () => {
    expect(routeVerificationProgressLabel(0, 2)).toContain('第 1 / 2 段');
    expect(routeVerificationProgressLabel(3, 2)).toContain('第 2 / 2 段');
  });
});
