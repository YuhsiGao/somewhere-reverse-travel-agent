import { describe, expect, it } from 'vitest';
import { buildDecisionStages, completedDecisionStages } from './DecisionStats';
import type { Funnel } from '../services/session-analytics';

function funnel(overrides: Partial<Funnel['counts']> = {}): Funnel {
  return {
    sessionId: 'session_test',
    counts: {
      brief_submitted: 0,
      constraints_applied: 0,
      candidates_viewed: 0,
      destination_selected: 0,
      itinerary_shared: 0,
      decision_package_exported: 0,
      navigation_opened: 0,
      plan_adopted: 0,
      plan_rejected: 0,
      media_added: 0,
      ...overrides,
    },
    completedStages: [],
    events: [],
  };
}

describe('DecisionStats funnel mapping', () => {
  it('maps the local ledger into the four decision stages', () => {
    const stages = buildDecisionStages(funnel({
      brief_submitted: 2,
      candidates_viewed: 2,
      destination_selected: 1,
      itinerary_shared: 1,
      navigation_opened: 3,
      plan_adopted: 2,
      plan_rejected: 1,
    }));

    expect(stages.map((stage) => [stage.label, stage.count])).toEqual([
      ['提交委托', 2], ['查看候选', 2], ['打开详情', 1], ['行动 / 决策', 7],
    ]);
    expect(stages[3].eventNames).toContain('navigation_opened');
    expect(stages[3].eventNames).toContain('plan_rejected');
  });

  it('counts completed stages instead of unrelated instrumentation events', () => {
    expect(completedDecisionStages(funnel({ media_added: 2, constraints_applied: 1 }))).toBe(0);
    expect(completedDecisionStages(funnel({ brief_submitted: 1, candidates_viewed: 1, plan_adopted: 1 }))).toBe(3);
  });
});
