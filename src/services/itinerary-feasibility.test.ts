import { describe, expect, it } from 'vitest';
import { evaluateDayFeasibility, formatPlanningDuration } from './itinerary-feasibility';
import type { DayPlan } from '../types';

const day = (stays: number[], legs: number[]): DayPlan => ({ day: 1, theme: '测试', intro: '', moments: [], dataStatus: 'static-editorial-demo', lastUpdated: '2026-08-04', pois: stays.map((stayMinutes, index) => ({ id: String(index), name: String(index), category: 'park', coordinates: [120, 30], stayMinutes, whyItFits: '', operatingRisk: '', source: { label: '', url: 'https://example.test', status: 'static-editorial-demo', updatedAt: '2026-08-04', note: '' } })), travelLegs: legs.map((durationMinutes, index) => ({ id: String(index), fromPoiId: 'a', toPoiId: 'b', mode: 'walk', distanceKm: 1, durationMinutes, navigationUrl: '', note: '' })) });

describe('itinerary feasibility', () => {
  it('uses explicit POI, travel and transition-budget inputs', () => {
    expect(evaluateDayFeasibility(day([60, 90, 45], [20, 15]))).toMatchObject({ poiMinutes: 195, travelMinutes: 35, bufferMinutes: 30, plannedMinutes: 260, level: 'light' });
  });
  it('flags an overfull day without pretending live validation', () => {
    expect(evaluateDayFeasibility(day([180, 180, 160], [45, 50]))).toMatchObject({ plannedMinutes: 645, remainingMinutes: -165, level: 'overloaded', label: '过满，建议删减或拆分' });
    expect(formatPlanningDuration(125)).toBe('2 小时 5 分');
  });
});
