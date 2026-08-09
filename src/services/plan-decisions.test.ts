import { describe, expect, it } from 'vitest';
import type { DayPlan } from '../types';
import {
  PLAN_DECISION_STORAGE_PREFIX,
  clearPlanDecision,
  createPlanDecision,
  itineraryVersion,
  loadPlanDecision,
  planDecisionStorageKey,
  savePlanDecision,
} from './plan-decisions';

const itinerary: DayPlan[] = [{ day: 1, theme: '不应被保存', intro: '不应被保存', moments: [], pois: [{ id: 'poi-1', name: '不应被保存', category: 'park', coordinates: [120, 30], stayMinutes: 30, whyItFits: '不应被保存', operatingRisk: '不应被保存', source: { label: 'source', url: 'https://example.test', status: 'static-editorial-demo', updatedAt: '2026-08-04', note: 'note' } }], travelLegs: [], dataStatus: 'static-editorial-demo', lastUpdated: '2026-08-04' }];

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key), values };
}

describe('plan decisions', () => {
  it('creates a stable editorial itinerary version without plan prose', () => {
    const version = itineraryVersion(itinerary);
    expect(version).toContain('1@2026-08-04:poi-1');
    expect(version).not.toContain('不应被保存');
    expect(itineraryVersion([...itinerary].reverse())).toBe(version);
  });

  it('requires an enum reason only for a non-adopted result', () => {
    expect(createPlanDecision('songyang', 'v1', 'adopted')).toEqual({ destinationId: 'songyang', itineraryVersion: 'v1', outcome: 'adopted' });
    expect(createPlanDecision('songyang', 'v1', 'not-adopted')).toBeUndefined();
    expect(createPlanDecision('songyang', 'v1', 'not-adopted', 'budget')).toMatchObject({ outcome: 'not-adopted', reason: 'budget' });
    expect(createPlanDecision('songyang', 'v1', 'not-adopted', 'free text' as never)).toBeUndefined();
  });

  it('stores and restores only the exact structured decision', () => {
    const local = memoryStorage();
    const decision = createPlanDecision('songyang', 'editorial-v1:one', 'not-adopted', 'transport')!;
    expect(savePlanDecision(decision, local)).toBe(true);
    const key = planDecisionStorageKey('songyang', 'editorial-v1:one')!;
    expect(key).toContain(PLAN_DECISION_STORAGE_PREFIX);
    expect(JSON.parse(local.getItem(key) ?? '{}')).toEqual(decision);
    expect(JSON.stringify(local.getItem(key))).not.toContain('不应被保存');
    expect(loadPlanDecision('songyang', 'editorial-v1:one', local)).toEqual(decision);
    expect(loadPlanDecision('another-city', 'editorial-v1:one', local)).toBeUndefined();
  });

  it('rejects malformed data and safely clears a decision', () => {
    const key = planDecisionStorageKey('songyang', 'v1')!;
    const malformed = memoryStorage({ [key]: JSON.stringify({ destinationId: 'songyang', itineraryVersion: 'v1', outcome: 'not-adopted', reason: 'a paragraph' }) });
    expect(loadPlanDecision('songyang', 'v1', malformed)).toBeUndefined();
    const decision = createPlanDecision('songyang', 'v1', 'adopted')!;
    expect(savePlanDecision(decision, malformed)).toBe(true);
    expect(clearPlanDecision('songyang', 'v1', malformed)).toBe(true);
    expect(loadPlanDecision('songyang', 'v1', malformed)).toBeUndefined();
  });

  it('degrades safely when browser storage is unavailable', () => {
    const unavailable = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const decision = createPlanDecision('songyang', 'v1', 'adopted')!;
    expect(savePlanDecision(decision, unavailable)).toBe(false);
    expect(loadPlanDecision('songyang', 'v1', unavailable)).toBeUndefined();
    expect(clearPlanDecision('songyang', 'v1', unavailable)).toBe(false);
  });
});
