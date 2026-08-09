import { describe, expect, it } from 'vitest';
import { destinations } from '../data';
import { decisionActionLabel } from './CandidateComparison';

describe('CandidateComparison decision contract', () => {
  it('keeps every next-step control destination-specific for assistive technology', () => {
    expect(destinations.domestic.map(decisionActionLabel)).toEqual(['查看松阳的旅行方案', '查看南山竹海的旅行方案', '查看宁海的旅行方案']);
  });
});
