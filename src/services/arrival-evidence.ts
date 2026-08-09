export type ArrivalEvidence = {
  provider: 'osrm';
  checkedAt: string;
  departure: string;
  transport: 'drive';
  distanceKm: number;
  durationMinutes: number;
};

export const ARRIVAL_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

export function isArrivalEvidenceFresh(evidence: ArrivalEvidence | undefined, now: Date = new Date()): evidence is ArrivalEvidence {
  if (!evidence || evidence.provider !== 'osrm' || evidence.transport !== 'drive' || !evidence.departure || Number.isNaN(Date.parse(evidence.checkedAt))) return false;
  const age = now.getTime() - Date.parse(evidence.checkedAt);
  return age >= 0 && age <= ARRIVAL_EVIDENCE_MAX_AGE_MS && Number.isFinite(evidence.distanceKm) && evidence.distanceKm >= 0 && Number.isFinite(evidence.durationMinutes) && evidence.durationMinutes >= 0;
}

function key(destinationId: string) { return `somewhere.arrival-evidence.v1.${destinationId}`; }
function storage() { try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; } }
function notifyEvidenceUpdate() { try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('somewhere:evidence-updated')); } catch { /* local UI refresh is optional */ } }

export function saveArrivalEvidence(destinationId: string, evidence: ArrivalEvidence) {
  const target = storage();
  if (!destinationId || !target || !isArrivalEvidenceFresh(evidence)) return false;
  try { target.setItem(key(destinationId), JSON.stringify(evidence)); notifyEvidenceUpdate(); return true; } catch { return false; }
}

export function loadArrivalEvidence(destinationId: string, now: Date = new Date()): ArrivalEvidence | undefined {
  const target = storage(); if (!target) return undefined;
  try { const value: unknown = JSON.parse(target.getItem(key(destinationId)) || 'null'); return isArrivalEvidenceFresh(value as ArrivalEvidence, now) ? value as ArrivalEvidence : undefined; } catch { return undefined; }
}
