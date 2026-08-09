import { describe, expect, it } from 'vitest';
import { buildAgentTraceSteps } from './AgentTrace';

describe('AgentTrace', () => {
  it('builds the four auditable planning stages with explicit provenance', () => {
    const steps = buildAgentTraceSteps({
      text: '从上海出发，国内住四天，想找一个安静能散步的地方',
      detectedConditions: [{ label: '出发地', value: '上海', applied: true }, { label: '天数', value: '4 天', applied: false }],
      queryConstraints: [{ label: '范围', value: '国内', kind: 'hard' }, { label: '交通', value: '铁路优先', kind: 'preference' }],
      candidateCount: 3,
      dataStatus: 'static-editorial-demo',
    });

    expect(steps.map((step) => step.title)).toEqual(['意图抽取', '硬约束校验', '编辑库召回与排序', '路线 / 证据审查']);
    expect(steps[0].provenance).toContain('AI推断');
    expect(steps[1].provenance).toContain('用户确认');
    expect(steps[2].provenance).toEqual(expect.arrayContaining(['静态编辑库', '未实时核验']));
    expect(steps[3].detail).toContain('不代表道路导航');
  });

  it('makes an empty retrieval and unapplied detected conditions transparent', () => {
    const steps = buildAgentTraceSteps({
      text: '想出去走走', candidateCount: 0, dataStatus: 'offline-demo',
      detectedConditions: [{ label: '范围', value: '国内' }],
      queryConstraints: [],
    });

    expect(steps[1].detail).toContain('尚未自动写入');
    expect(steps[2].detail).toContain('没有候选满足当前硬约束');
    expect(steps[2].provenance).toContain('未实时核验');
  });
});
