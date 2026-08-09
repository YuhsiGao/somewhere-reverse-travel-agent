import { describe, expect, it } from 'vitest';
import { createSessionAnalytics, type StorageLike } from './session-analytics';

function storage(seed: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('session analytics', () => {
  it('tracks a local event and returns a per-session funnel', () => {
    const analytics = createSessionAnalytics({ storage: storage(), sessionStorage: storage(), sessionId: 'a', now: () => new Date('2026-08-04T00:00:00Z') });
    analytics.track('brief_submitted', { source: 'text', length: 32 });
    analytics.track('candidates_viewed');

    expect(analytics.getFunnel()).toMatchObject({
      sessionId: 'a',
      counts: { brief_submitted: 1, candidates_viewed: 1, navigation_opened: 0 },
      completedStages: ['brief_submitted', 'candidates_viewed'],
    });
    expect(analytics.getFunnel().events[0]).toMatchObject({ at: '2026-08-04T00:00:00.000Z', properties: { source: 'text', length: 32 } });
  });

  it('isolates shared persistent events by session', () => {
    const events = storage();
    createSessionAnalytics({ storage: events, sessionStorage: storage(), sessionId: 'first' }).track('media_added');
    const second = createSessionAnalytics({ storage: events, sessionStorage: storage(), sessionId: 'second' });
    second.track('brief_submitted');

    expect(second.getFunnel().counts).toMatchObject({ media_added: 0, brief_submitted: 1 });
  });

  it('ignores malformed persisted JSON and continues in memory', () => {
    const events = storage({ 'somewhere.session-analytics.events.v1': '{invalid' });
    const analytics = createSessionAnalytics({ storage: events, sessionStorage: storage(), sessionId: 'safe' });
    analytics.track('destination_selected');
    expect(analytics.getFunnel().counts.destination_selected).toBe(1);
  });

  it('falls back safely when storage throws and reset clears this session only', () => {
    const broken: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const analytics = createSessionAnalytics({ storage: broken, sessionStorage: broken, sessionId: 'memory-only' });
    analytics.track('navigation_opened');
    expect(analytics.getFunnel().counts.navigation_opened).toBe(1);
    analytics.reset();
    expect(analytics.getFunnel().events).toEqual([]);
  });

  it('records an adopted plan without any properties', () => {
    const analytics = createSessionAnalytics({ storage: storage(), sessionStorage: storage(), sessionId: 'decision' });
    analytics.track('plan_adopted');

    expect(analytics.getFunnel().counts.plan_adopted).toBe(1);
    expect(analytics.getFunnel().events[0]).not.toHaveProperty('properties');
  });

  it('only retains an enumerated rejection reason and strips unsafe stored decision data', () => {
    const events = storage({
      'somewhere.session-analytics.events.v1': JSON.stringify([
        { name: 'plan_rejected', sessionId: 'decision', at: '2026-08-04T00:00:00.000Z', properties: { rejectionReason: 'budget', destinationName: '杭州', itinerary: 'secret' } },
        { name: 'plan_adopted', sessionId: 'decision', at: '2026-08-04T00:01:00.000Z', properties: { destinationName: '成都' } },
      ]),
    });
    const analytics = createSessionAnalytics({ storage: events, sessionStorage: storage(), sessionId: 'decision' });
    analytics.track('plan_rejected', { rejectionReason: 'transport' });

    expect(analytics.getFunnel().counts).toMatchObject({ plan_rejected: 2, plan_adopted: 1 });
    expect(analytics.getFunnel().events.map((event) => event.properties)).toEqual([
      { rejectionReason: 'budget' }, undefined, { rejectionReason: 'transport' },
    ]);
  });

  it('rejects arbitrary rejection text at runtime while retaining the event safely', () => {
    const analytics = createSessionAnalytics({ storage: storage(), sessionStorage: storage(), sessionId: 'decision' });
    analytics.track('plan_rejected', { rejectionReason: 'a private reason' as never });

    expect(analytics.getFunnel().events[0]).not.toHaveProperty('properties');
  });
});
