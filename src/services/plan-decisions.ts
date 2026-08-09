import type { DayPlan } from '../types';

/**
 * Local-only plan feedback. This deliberately has no free-text field: it is
 * useful for a later visit without becoming a second copy of a travel brief.
 */
export const PLAN_DECISION_STORAGE_PREFIX = 'somewhere.plan-decision.v1';

export const PLAN_REJECTION_REASONS = ['budget', 'time', 'transport', 'vibe', 'other'] as const;
export type PlanRejectionReason = typeof PLAN_REJECTION_REASONS[number];
export type PlanDecisionOutcome = 'adopted' | 'not-adopted';

export type PlanDecision = {
  destinationId: string;
  itineraryVersion: string;
  outcome: PlanDecisionOutcome;
  reason?: PlanRejectionReason;
};

export type PlanDecisionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const MAX_IDENTIFIER_LENGTH = 160;

function browserStorage(): PlanDecisionStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;
}

function isReason(value: unknown): value is PlanRejectionReason {
  return typeof value === 'string' && PLAN_REJECTION_REASONS.includes(value as PlanRejectionReason);
}

/** A deterministic version derived solely from the editorial plan's stable IDs and update dates. */
export function itineraryVersion(itinerary: readonly DayPlan[]): string {
  const signature = itinerary
    .slice()
    .sort((left, right) => left.day - right.day)
    .map((day) => `${day.day}@${day.lastUpdated}:${day.pois.map((poi) => poi.id).join(',')}`)
    .join('|');
  return `editorial-v1:${signature || 'empty'}`.slice(0, MAX_IDENTIFIER_LENGTH);
}

export function planDecisionStorageKey(destinationId: string, version: string): string | undefined {
  if (!validIdentifier(destinationId) || !validIdentifier(version)) return undefined;
  return `${PLAN_DECISION_STORAGE_PREFIX}.${encodeURIComponent(destinationId)}.${encodeURIComponent(version)}`;
}

export function createPlanDecision(
  destinationId: string,
  version: string,
  outcome: PlanDecisionOutcome,
  reason?: PlanRejectionReason,
): PlanDecision | undefined {
  if (!validIdentifier(destinationId) || !validIdentifier(version)) return undefined;
  if (outcome === 'adopted' && reason === undefined) return { destinationId, itineraryVersion: version, outcome };
  if (outcome === 'not-adopted' && isReason(reason)) return { destinationId, itineraryVersion: version, outcome, reason };
  return undefined;
}

export function isPlanDecision(value: unknown): value is PlanDecision {
  if (!value || typeof value !== 'object') return false;
  const decision = value as Partial<PlanDecision>;
  if (!validIdentifier(decision.destinationId) || !validIdentifier(decision.itineraryVersion)) return false;
  return (decision.outcome === 'adopted' && decision.reason === undefined)
    || (decision.outcome === 'not-adopted' && isReason(decision.reason));
}

/** Restores only a validated decision belonging to this exact destination and plan version. */
export function loadPlanDecision(destinationId: string, version: string, storage: PlanDecisionStorage | undefined = browserStorage()): PlanDecision | undefined {
  const key = planDecisionStorageKey(destinationId, version);
  if (!key || !storage) return undefined;
  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isPlanDecision(parsed) && parsed.destinationId === destinationId && parsed.itineraryVersion === version ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the minimal structured record. No user text, plan copy, or network request is involved. */
export function savePlanDecision(decision: PlanDecision, storage: PlanDecisionStorage | undefined = browserStorage()): boolean {
  const key = planDecisionStorageKey(decision.destinationId, decision.itineraryVersion);
  if (!key || !storage || !isPlanDecision(decision)) return false;
  try {
    storage.setItem(key, JSON.stringify(decision));
    return true;
  } catch {
    return false;
  }
}

/** Removes the exact local decision, allowing the user to make a different choice. */
export function clearPlanDecision(destinationId: string, version: string, storage: PlanDecisionStorage | undefined = browserStorage()): boolean {
  const key = planDecisionStorageKey(destinationId, version);
  if (!key || !storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
