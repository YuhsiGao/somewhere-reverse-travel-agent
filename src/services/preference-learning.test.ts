import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import {
  PREFERENCE_PROFILE_STORAGE_KEY,
  clearPreferenceProfile,
  derivePreferenceProfile,
  loadPreferenceProfile,
  rankByPreferenceIncrement,
  savePreferenceProfile,
  type StorageLike,
} from './preference-learning';

function storage(seed: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const songyang = destinations.domestic.find((destination) => destination.id === 'songyang')!;
const liyang = destinations.domestic.find((destination) => destination.id === 'liyang')!;
const ninghai = destinations.domestic.find((destination) => destination.id === 'ninghai')!;
const hakodate = destinations.harbor.find((destination) => destination.id === 'hakodate')!;
const kamakura = destinations.summer.find((destination) => destination.id === 'kamakura')!;

describe('preference learning', () => {
  it('derives only transparent tags, travel scope and recommendation roles', () => {
    const profile = derivePreferenceProfile([songyang, liyang, hakodate]);

    expect(profile).toEqual(expect.objectContaining({ version: 1, savedDestinationCount: 3, travelScope: 'mixed' }));
    expect(profile.atmosphereTags).toEqual(expect.arrayContaining([{ label: '山水', saves: 1 }, { label: '竹林', saves: 1 }, { label: '港口', saves: 1 }]));
    expect(profile.rolePreferences).toEqual(expect.arrayContaining([{ role: 'best-match', saves: 2 }, { role: 'unexpected', saves: 1 }]));
  });

  it('does not create a profile from free-form trip text or persist destination copy', () => {
    const profile = derivePreferenceProfile([liyang]);
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain(songyang.tagline);
    expect(serialized).not.toContain(songyang.reasons[0]);
    expect(serialized).not.toContain(songyang.city);
    expect(serialized).not.toContain('我想去');
  });

  it('adds explainable preference increments while preserving every hard-filtered candidate', () => {
    const profile = derivePreferenceProfile([songyang, liyang]);
    const candidates = [ninghai, liyang];
    const ranked = rankByPreferenceIncrement(candidates, profile);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((item) => item.destination.id).sort()).toEqual(['liyang', 'ninghai']);
    expect(candidates.map((item) => item.id)).toEqual(['ninghai', 'liyang']);
    const bamboo = ranked.find((item) => item.destination.id === liyang.id);
    expect(bamboo).toMatchObject({ baseScore: liyang.matchScore, finalScore: expect.any(Number) });
    expect(bamboo?.preferenceIncrement).toBeGreaterThan(0);
    expect(bamboo?.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'atmosphere', label: '竹林', evidence: '已收藏 1 个同类氛围标签目的地' })]));
  });

  it('keeps stable base-score order when no learned preference matches', () => {
    const profile = derivePreferenceProfile([liyang]);
    const ranked = rankByPreferenceIncrement([hakodate, kamakura], profile);
    expect(ranked.map((item) => item.destination.id)).toEqual(['kamakura', 'hakodate']);
    expect(ranked.every((item) => item.preferenceIncrement === 0)).toBe(true);
  });

  it('safely saves, reloads and clears a validated local profile', () => {
    const local = storage();
    const profile = derivePreferenceProfile([songyang]);
    expect(savePreferenceProfile(profile, local)).toBe(true);
    expect(JSON.parse(local.getItem(PREFERENCE_PROFILE_STORAGE_KEY) ?? '{}')).toEqual(profile);
    expect(loadPreferenceProfile(local)).toEqual(profile);
    expect(clearPreferenceProfile(local)).toBe(true);
    expect(loadPreferenceProfile(local)).toBeUndefined();
  });

  it('rejects malformed profiles and storage failures without throwing', () => {
    const malformed = storage({ [PREFERENCE_PROFILE_STORAGE_KEY]: JSON.stringify({ version: 1, travelScope: 'domestic', atmosphereTags: 'not-array' }) });
    const broken: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadPreferenceProfile(malformed)).toBeUndefined();
    expect(savePreferenceProfile(derivePreferenceProfile([songyang]), broken)).toBe(false);
    expect(clearPreferenceProfile(broken)).toBe(false);
  });
});
