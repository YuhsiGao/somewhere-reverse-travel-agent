import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import { decisionReadiness } from './DecisionReadiness';

describe('decision readiness', () => {
  const itinerary = destinations.domestic[0].itineraryVariants?.[3] ?? destinations.domestic[0].itinerary;
  const now = new Date('2026-08-04T12:00:00.000Z');
  const weather = { forecast: { date: '2026-08-04', weatherCode: 1, minC: 20, maxC: 30, precipitationProbabilityMax: 10, windSpeedMax: 12 }, checkedAt: '2026-08-04T11:55:00.000Z' };
  it('reports evidence coverage without treating editorial content as verification', () => {
    expect(decisionReadiness(itinerary, undefined, {}, undefined, now)).toMatchObject({ score: 0, verifiedDays: 0, arrival: false });
    expect(decisionReadiness(itinerary, weather, { 1: {} }, {}, now)).toMatchObject({ score: 67, weather: true, verifiedDays: 1, arrival: true });
  });
});
