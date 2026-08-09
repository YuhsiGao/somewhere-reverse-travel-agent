import { describe, expect, it } from 'vitest';
import { buildDepartureChecklistItems, departureChecklistStorageKey, loadDepartureChecklist, resetDepartureChecklist, saveDepartureChecklist } from './DepartureChecklist';
import type { DayPlan, Destination } from '../types';

const poi = { id: 'poi-a', name: '测试地点', category: 'park' as const, coordinates: [120, 30] as [number, number], stayMinutes: 30, whyItFits: '测试', operatingRisk: '请确认营业时间和预约。', source: { label: '示例', url: 'https://example.test', status: 'static-editorial-demo' as const, updatedAt: '2026-08-04', note: '示例' } };
const itinerary: DayPlan[] = [{ day: 1, theme: '测试日', intro: '测试', moments: [], pois: [poi], travelLegs: [], dataStatus: 'static-editorial-demo', lastUpdated: '2026-08-04' }];
const destination = { id: 'test-city', city: '测试城', region: '测试区', country: '中国', itinerary } as Destination;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
}

describe('DepartureChecklist', () => {
  it('derives transparent weather, operating, route and arrival checks from itinerary data', () => {
    const items = buildDepartureChecklistItems(destination, itinerary, { 1: 'failed' });
    expect(items.map((item) => item.category)).toEqual(expect.arrayContaining(['weather', 'operating', 'route', 'arrival']));
    expect(items.find((item) => item.category === 'operating')?.detail).toContain('营业时间');
    expect(items.find((item) => item.category === 'route')?.detail).toContain('未生成可用路线');
    expect(items.find((item) => item.category === 'arrival')?.detail).toContain('未接入实时班次');
  });

  it('uses a plan-specific local key and safely persists only completed ids', () => {
    const key = departureChecklistStorageKey(destination, itinerary);
    const storage = memoryStorage();
    expect(saveDepartureChecklist(key, ['weather-day-1', 'weather-day-1'], storage)).toBe(true);
    expect(loadDepartureChecklist(key, storage)).toEqual(['weather-day-1']);
    expect(resetDepartureChecklist(key, storage)).toBe(true);
    expect(loadDepartureChecklist(key, storage)).toEqual([]);
  });

  it('degrades safely for malformed or unavailable local storage', () => {
    const key = departureChecklistStorageKey(destination, itinerary);
    expect(loadDepartureChecklist(key, memoryStorage({ [key]: '{not json' }))).toEqual([]);
    const failingStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadDepartureChecklist(key, failingStorage)).toEqual([]);
    expect(saveDepartureChecklist(key, ['weather-day-1'], failingStorage)).toBe(false);
    expect(resetDepartureChecklist(key, failingStorage)).toBe(false);
  });
});
