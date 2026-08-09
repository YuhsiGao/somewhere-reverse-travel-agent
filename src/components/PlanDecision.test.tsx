import { describe, expect, it } from 'vitest';
import { rejectionReasonLabel, type PlanDecisionEvent, type PlanDecisionProps } from './PlanDecision';
import { PLAN_REJECTION_REASONS } from '../services/plan-decisions';

describe('PlanDecision presentation contract', () => {
  it('presents every permitted structured non-adoption reason and no free-text option', () => {
    expect(Object.keys(rejectionReasonLabel).sort()).toEqual([...PLAN_REJECTION_REASONS].sort());
    expect(Object.values(rejectionReasonLabel)).toEqual(['预算不合适', '时间不合适', '交通不合适', '氛围不符', '其他原因']);
    expect(Object.values(rejectionReasonLabel).join('')).not.toContain('输入');
  });

  it('exposes an optional, structured host callback with no identifying or free-text fields', () => {
    const events: PlanDecisionEvent[] = [];
    const props: PlanDecisionProps = {
      destination: { id: 'never-forwarded', city: 'never-forwarded' },
      itinerary: [],
      onDecision: (event) => events.push(event),
    };

    props.onDecision?.({ outcome: 'adopted' });
    props.onDecision?.({ outcome: 'not-adopted', reason: 'transport' });
    props.onDecision?.({ outcome: 'cleared' });

    expect(events).toEqual([
      { outcome: 'adopted' },
      { outcome: 'not-adopted', reason: 'transport' },
      { outcome: 'cleared' },
    ]);
    expect(JSON.stringify(events)).not.toContain('never-forwarded');
    expect(events.every((event) => Object.keys(event).every((key) => ['outcome', 'reason'].includes(key)))).toBe(true);
  });
});
