import type { Destination, Role } from '../types';

/**
 * This module is intentionally local-only. It learns only from structured
 * favourite destinations and never accepts, stores, or sends a free-form trip
 * brief. Callers must apply all hard constraints before ranking candidates.
 */
export type TravelScope = 'domestic' | 'overseas' | 'mixed' | 'unknown';

export type PreferenceTag = {
  label: string;
  saves: number;
};

export type RolePreference = {
  role: Role;
  saves: number;
};

export type PreferenceProfile = {
  version: 1;
  savedDestinationCount: number;
  travelScope: TravelScope;
  atmosphereTags: PreferenceTag[];
  rolePreferences: RolePreference[];
};

export type PreferenceReason = {
  kind: 'atmosphere' | 'role';
  label: string;
  increment: number;
  evidence: string;
};

export type PreferenceRankedDestination = {
  destination: Destination;
  baseScore: number;
  preferenceIncrement: number;
  finalScore: number;
  reasons: PreferenceReason[];
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PREFERENCE_PROFILE_STORAGE_KEY = 'somewhere.preference-profile.v1';
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 48;
const MAX_TAG_INCREMENT = 9;
const MAX_ROLE_INCREMENT = 3;

const ROLES: readonly Role[] = ['best-match', 'unexpected', 'easy-to-reach'];

function getBrowserStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role);
}

function cleanTag(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
}

function sortByFrequency<T extends { saves: number }>(items: T[], label: (item: T) => string) {
  return items.sort((left, right) => right.saves - left.saves || label(left).localeCompare(label(right), 'zh-Hans-CN'));
}

/** Builds a small, inspectable profile from saved structured destinations only. */
export function derivePreferenceProfile(favourites: readonly Destination[]): PreferenceProfile {
  const tags = new Map<string, number>();
  const roles = new Map<Role, number>();
  let domestic = 0;
  let overseas = 0;

  for (const destination of favourites) {
    if (destination.country === '中国') domestic += 1;
    else overseas += 1;
    roles.set(destination.role, (roles.get(destination.role) ?? 0) + 1);
    for (const rawTag of destination.atmosphere) {
      const tag = cleanTag(rawTag);
      if (tag) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
  }

  const travelScope: TravelScope = domestic && overseas ? 'mixed' : domestic ? 'domestic' : overseas ? 'overseas' : 'unknown';
  const atmosphereTags = sortByFrequency(
    [...tags].map(([label, saves]) => ({ label, saves })),
    (tag) => tag.label,
  ).slice(0, MAX_TAGS);
  const rolePreferences = sortByFrequency(
    [...roles].map(([role, saves]) => ({ role, saves })),
    (preference) => preference.role,
  );

  return { version: 1, savedDestinationCount: favourites.length, travelScope, atmosphereTags, rolePreferences };
}

/**
 * Reorders an already hard-filtered candidate list. It never removes, adds,
 * or mutates a candidate, so duration, location, budget and other hard
 * conditions stay under the caller's control.
 */
export function rankByPreferenceIncrement(
  hardFilteredCandidates: readonly Destination[],
  profile: PreferenceProfile,
): PreferenceRankedDestination[] {
  const tagSaves = new Map(profile.atmosphereTags.map((tag) => [tag.label, tag.saves]));
  const roleSaves = new Map(profile.rolePreferences.map((role) => [role.role, role.saves]));

  return hardFilteredCandidates
    .map((destination, index) => {
      const reasons: PreferenceReason[] = [];
      const matchingTags = [...new Set(destination.atmosphere.map(cleanTag).filter((tag) => tagSaves.has(tag)))];
      for (const tag of matchingTags) {
        const saves = tagSaves.get(tag) ?? 0;
        const increment = Math.min(MAX_TAG_INCREMENT, 2 + saves);
        reasons.push({ kind: 'atmosphere', label: tag, increment, evidence: `已收藏 ${saves} 个同类氛围标签目的地` });
      }
      const roleSavesCount = roleSaves.get(destination.role) ?? 0;
      if (roleSavesCount) {
        const increment = Math.min(MAX_ROLE_INCREMENT, roleSavesCount);
        reasons.push({ kind: 'role', label: destination.roleLabel, increment, evidence: `已收藏 ${roleSavesCount} 个同类推荐角色目的地` });
      }
      const preferenceIncrement = reasons.reduce((total, reason) => total + reason.increment, 0);
      return { destination, baseScore: destination.matchScore, preferenceIncrement, finalScore: destination.matchScore + preferenceIncrement, reasons, index };
    })
    .sort((left, right) => right.finalScore - left.finalScore || right.baseScore - left.baseScore || left.index - right.index)
    .map(({ index: _index, ...ranked }) => ranked);
}

function isProfile(value: unknown): value is PreferenceProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<PreferenceProfile>;
  return profile.version === 1
    && typeof profile.savedDestinationCount === 'number'
    && ['domestic', 'overseas', 'mixed', 'unknown'].includes(profile.travelScope ?? '')
    && Array.isArray(profile.atmosphereTags)
    && profile.atmosphereTags.every((tag) => tag && typeof tag.label === 'string' && typeof tag.saves === 'number')
    && Array.isArray(profile.rolePreferences)
    && profile.rolePreferences.every((role) => role && isRole(role.role) && typeof role.saves === 'number');
}

/** Reads a validated profile. Malformed or unavailable storage behaves as empty state. */
export function loadPreferenceProfile(storage: StorageLike | undefined = getBrowserStorage()): PreferenceProfile | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(PREFERENCE_PROFILE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isProfile(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Persists only the transparent profile fields; returns false when storage is unavailable. */
export function savePreferenceProfile(profile: PreferenceProfile, storage: StorageLike | undefined = getBrowserStorage()): boolean {
  if (!storage || !isProfile(profile)) return false;
  try {
    storage.setItem(PREFERENCE_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

/** Removes locally persisted preference data. */
export function clearPreferenceProfile(storage: StorageLike | undefined = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(PREFERENCE_PROFILE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
