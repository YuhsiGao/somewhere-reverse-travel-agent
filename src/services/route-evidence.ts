import type { DayPlan } from '../types';

export type RouteEvidence = {
  provider: 'osrm';
  checkedAt: string;
  distanceKm: number;
  durationMinutes: number;
  legCount: number;
};

export const ROUTE_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

export function isRouteEvidenceFresh(evidence: RouteEvidence | undefined, now: Date = new Date()): evidence is RouteEvidence {
  if (!evidence || evidence.provider !== 'osrm' || Number.isNaN(Date.parse(evidence.checkedAt))) return false;
  const age = now.getTime() - Date.parse(evidence.checkedAt);
  return age >= 0 && age <= ROUTE_EVIDENCE_MAX_AGE_MS && Number.isFinite(evidence.distanceKm) && evidence.distanceKm >= 0
    && Number.isFinite(evidence.durationMinutes) && evidence.durationMinutes >= 0 && Number.isInteger(evidence.legCount) && evidence.legCount > 0;
}

function storageKey(destinationId: string) { return `somewhere.route-evidence.v1.${destinationId}`; }
function browserStorage() { try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; } }
function notifyEvidenceUpdate() { try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('somewhere:evidence-updated')); } catch { /* local UI refresh is optional */ } }

/** Local session evidence deliberately excludes raw coordinates and route geometry. */
export function saveRouteEvidence(destinationId: string, day: number, evidence: RouteEvidence) {
  if (!destinationId || !Number.isInteger(day) || day < 1 || !isRouteEvidenceFresh(evidence)) return false;
  const storage = browserStorage(); if (!storage) return false;
  try {
    const current = JSON.parse(storage.getItem(storageKey(destinationId)) || '{}') as Record<string, RouteEvidence>;
    current[String(day)] = evidence;
    storage.setItem(storageKey(destinationId), JSON.stringify(current));
    notifyEvidenceUpdate();
    return true;
  } catch { return false; }
}

export function loadRouteEvidence(destinationId: string, itinerary: DayPlan[], now: Date = new Date()): Partial<Record<number, RouteEvidence>> {
  const storage = browserStorage(); if (!storage) return {};
  try {
    const raw: unknown = JSON.parse(storage.getItem(storageKey(destinationId)) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const days = new Set(itinerary.map((day) => day.day));
    return Object.entries(raw as Record<string, RouteEvidence>).reduce<Partial<Record<number, RouteEvidence>>>((result, [key, value]) => {
      const day = Number(key); if (Number.isInteger(day) && days.has(day) && isRouteEvidenceFresh(value, now)) result[day] = value;
      return result;
    }, {});
  } catch { return {}; }
}
