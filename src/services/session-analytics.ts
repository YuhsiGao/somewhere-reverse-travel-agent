/**
 * A deliberately small, local-only analytics ledger. It never sends requests
 * and stores no free-form travel brief or media data.
 */
export const SESSION_ANALYTICS_EVENTS = [
  'brief_submitted',
  'constraints_applied',
  'candidates_viewed',
  'destination_selected',
  'itinerary_shared',
  'decision_package_exported',
  'navigation_opened',
  'plan_adopted',
  'plan_rejected',
  'media_added',
] as const;

export type SessionAnalyticsEvent = (typeof SESSION_ANALYTICS_EVENTS)[number];
export type AnalyticsProperties = Record<string, string | number | boolean | null>;
export const PLAN_REJECTION_REASONS = ['budget', 'time', 'transport', 'vibe', 'other'] as const;
export type PlanRejectionReason = (typeof PLAN_REJECTION_REASONS)[number];

type PropertiesForEvent<EventName extends SessionAnalyticsEvent> =
  EventName extends 'plan_rejected' ? { rejectionReason?: PlanRejectionReason }
    : EventName extends 'plan_adopted' ? never
      : AnalyticsProperties;

export type TrackedEvent = {
  name: SessionAnalyticsEvent;
  sessionId: string;
  at: string;
  properties?: AnalyticsProperties;
};

export type Funnel = {
  sessionId: string;
  counts: Record<SessionAnalyticsEvent, number>;
  completedStages: SessionAnalyticsEvent[];
  events: TrackedEvent[];
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type SessionAnalyticsOptions = {
  storage?: StorageLike;
  sessionStorage?: StorageLike;
  sessionId?: string;
  now?: () => Date;
};

const EVENTS_KEY = 'somewhere.session-analytics.events.v1';
const SESSION_KEY = 'somewhere.session-analytics.session-id.v1';
const MAX_EVENTS = 200;
let memoryEvents: TrackedEvent[] = [];
let memorySessionId: string | undefined;

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window[kind];
  } catch {
    return undefined;
  }
}

function newSessionId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall back to a timestamp-based identifier in restrictive browsers.
  }
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isEvent(value: unknown): value is TrackedEvent {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TrackedEvent>;
  return typeof item.sessionId === 'string'
    && typeof item.at === 'string'
    && SESSION_ANALYTICS_EVENTS.includes(item.name as SessionAnalyticsEvent);
}

/**
 * Decision events are deliberately more restrictive than the legacy ledger:
 * they cannot carry a destination name, itinerary, or free-form rejection text.
 */
function sanitizeProperties<EventName extends SessionAnalyticsEvent>(name: EventName, properties?: PropertiesForEvent<EventName>) {
  if (name === 'plan_adopted') return undefined;
  if (name === 'plan_rejected') {
    const reason = (properties as { rejectionReason?: unknown } | undefined)?.rejectionReason;
    return typeof reason === 'string' && PLAN_REJECTION_REASONS.includes(reason as PlanRejectionReason)
      ? { rejectionReason: reason as PlanRejectionReason }
      : undefined;
  }
  return properties as AnalyticsProperties | undefined;
}

function sanitizeStoredEvent(event: TrackedEvent): TrackedEvent {
  const properties = sanitizeProperties(event.name, event.properties as never);
  return { name: event.name, sessionId: event.sessionId, at: event.at, ...(properties ? { properties } : {}) };
}

function readEvents(storage?: StorageLike): TrackedEvent[] {
  if (!storage) return memoryEvents;
  try {
    const raw = storage.getItem(EVENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEvent).map(sanitizeStoredEvent).slice(-MAX_EVENTS) : [];
  } catch {
    return memoryEvents;
  }
}

function writeEvents(events: TrackedEvent[], storage?: StorageLike) {
  memoryEvents = events.slice(-MAX_EVENTS);
  if (!storage) return;
  try {
    storage.setItem(EVENTS_KEY, JSON.stringify(memoryEvents));
  } catch {
    // Storage can be disabled, full, or blocked in private contexts. Memory remains usable.
  }
}

function resolveSessionId(storage: StorageLike | undefined, supplied?: string) {
  if (supplied) return supplied;
  if (storage) {
    try {
      const stored = storage.getItem(SESSION_KEY);
      if (stored) return stored;
      const created = newSessionId();
      storage.setItem(SESSION_KEY, created);
      return created;
    } catch {
      // Use the in-memory fallback below.
    }
  }
  memorySessionId ??= newSessionId();
  return memorySessionId;
}

export function createSessionAnalytics(options: SessionAnalyticsOptions = {}) {
  const eventStorage = options.storage ?? browserStorage('localStorage');
  const idStorage = options.sessionStorage ?? browserStorage('sessionStorage');
  const sessionId = resolveSessionId(idStorage, options.sessionId);
  const now = options.now ?? (() => new Date());

  function track<EventName extends SessionAnalyticsEvent>(name: EventName, properties?: PropertiesForEvent<EventName>): TrackedEvent {
    const safeProperties = sanitizeProperties(name, properties);
    const event: TrackedEvent = { name, sessionId, at: now().toISOString(), ...(safeProperties ? { properties: safeProperties } : {}) };
    writeEvents([...readEvents(eventStorage), event], eventStorage);
    return event;
  }

  function getFunnel(): Funnel {
    const events = readEvents(eventStorage).filter((event) => event.sessionId === sessionId);
    const counts = Object.fromEntries(SESSION_ANALYTICS_EVENTS.map((event) => [event, 0])) as Funnel['counts'];
    for (const event of events) counts[event.name] += 1;
    return { sessionId, counts, completedStages: SESSION_ANALYTICS_EVENTS.filter((event) => counts[event] > 0), events };
  }

  function reset() {
    memoryEvents = readEvents(eventStorage).filter((event) => event.sessionId !== sessionId);
    if (eventStorage) {
      try {
        if (memoryEvents.length) eventStorage.setItem(EVENTS_KEY, JSON.stringify(memoryEvents));
        else eventStorage.removeItem(EVENTS_KEY);
      } catch {
        // The in-memory ledger has already been reset.
      }
    }
  }

  return { sessionId, track, getFunnel, reset };
}

const defaultAnalytics = createSessionAnalytics();
export const track = defaultAnalytics.track;
export const getFunnel = defaultAnalytics.getFunnel;
export const reset = defaultAnalytics.reset;
