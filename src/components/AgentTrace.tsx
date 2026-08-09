import type { CSSProperties } from 'react';

export type AgentTraceDataStatus = 'static-editorial-demo' | 'mixed' | 'live-unverified' | 'offline-demo';
export type DetectedCondition = {
  label: string;
  value: string | number;
  /** Whether the person explicitly applied this detected value to the query. */
  applied?: boolean;
};
export type QueryConstraint = {
  label: string;
  value: string | number;
  /** A hard constraint filters the catalog; a preference influences only ranking. */
  kind?: 'hard' | 'preference';
};

export type AgentTraceProps = {
  text: string;
  detectedConditions?: DetectedCondition[];
  queryConstraints?: QueryConstraint[];
  candidateCount: number;
  dataStatus: AgentTraceDataStatus;
  className?: string;
};

export type AgentTraceStep = {
  id: 'intent' | 'constraints' | 'retrieval' | 'review';
  index: string;
  title: string;
  detail: string;
  provenance: Array<'用户确认' | 'AI推断' | '静态编辑库' | '动态召回' | '未实时核验'>;
};

const statusCopy: Record<AgentTraceDataStatus, string> = {
  'static-editorial-demo': '静态编辑库 · 非实时',
  mixed: '混合数据 · 部分待核验',
  'live-unverified': 'Agent 动态召回 · 仍需核验',
  'offline-demo': '离线演示 · 非实时',
};

const tagColor: Record<AgentTraceStep['provenance'][number], CSSProperties> = {
  用户确认: { color: '#234336', background: '#e5efe8', borderColor: '#adc4b3' },
  AI推断: { color: '#765320', background: '#f8efd8', borderColor: '#ddc58d' },
  静态编辑库: { color: '#304866', background: '#e8eef5', borderColor: '#b8c7d8' },
  动态召回: { color: '#5f3d77', background: '#f0e7f5', borderColor: '#d3b9df' },
  未实时核验: { color: '#8a4034', background: '#fae9e4', borderColor: '#dfb1a7' },
};

function compactText(text: string) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length > 88 ? `${normalized.slice(0, 88)}…` : normalized || '未提供文字委托';
}

function conditionSummary(items: DetectedCondition[]) {
  return items.length ? items.map((item) => `${item.label}：${item.value}`).join(' · ') : '未从文字中识别到可确认的条件';
}

function constraintSummary(items: QueryConstraint[]) {
  return items.length ? items.map((item) => `${item.label}：${item.value}`).join(' · ') : '暂未设置硬约束；结果仅按氛围匹配';
}

/** A deterministic, UI-safe representation of the planning trace; no tool invocation is implied. */
export function buildAgentTraceSteps({ text, detectedConditions = [], queryConstraints = [], candidateCount, dataStatus }: Omit<AgentTraceProps, 'className'>): AgentTraceStep[] {
  const applied = detectedConditions.filter((condition) => condition.applied);
  const hardConstraints = queryConstraints.filter((constraint) => constraint.kind !== 'preference');
  const hasRealtimeData = dataStatus === 'live-unverified' || dataStatus === 'mixed';

  return [
    {
      id: 'intent', index: '01', title: '意图抽取',
      detail: `从委托中提炼旅行氛围与待确认条件：「${compactText(text)}」`,
      provenance: ['AI推断'],
    },
    {
      id: 'constraints', index: '02', title: '硬约束校验',
      detail: `${constraintSummary(hardConstraints)}。${applied.length ? `已应用文字条件：${conditionSummary(applied)}。` : '文字检测结果尚未自动写入本次条件。'}`,
      provenance: applied.length || hardConstraints.length ? ['用户确认', 'AI推断'] : ['AI推断'],
    },
    {
      id: 'retrieval', index: '03', title: hasRealtimeData ? '动态目的地召回' : '编辑库召回与排序',
      detail: candidateCount > 0
        ? hasRealtimeData ? `Agent 按已确认条件动态提出 ${candidateCount} 个候选，并让它们承担不同的决策角色。` : `按已确认条件从编辑库筛出 ${candidateCount} 个候选，再按氛围标签排序。`
        : '没有候选满足当前硬约束；请放宽范围、天数或预算后重试。',
      provenance: hasRealtimeData ? ['动态召回', 'AI推断', '未实时核验'] : ['静态编辑库', '未实时核验'],
    },
    {
      id: 'review', index: '04', title: '路线 / 证据审查',
      detail: hasRealtimeData
        ? '目的地与体验锚点来自本次动态召回；营业、票务、路况与交通时刻仍应在出行前逐项确认。'
        : '当前路线为编辑行程示意，不代表道路导航、营业状态或实时交通；请通过每个地点的来源链接核验。',
      provenance: hasRealtimeData ? ['动态召回', '未实时核验'] : ['静态编辑库', '未实时核验'],
    },
  ];
}

const panelStyle: CSSProperties = {
  border: '1px solid #c9c4b7', borderRadius: 14, background: '#f8f5ed', color: '#283129',
  padding: '20px clamp(16px, 3vw, 28px)', boxShadow: '0 10px 30px rgba(45, 47, 39, .07)',
};

export default function AgentTrace(props: AgentTraceProps) {
  const { className, dataStatus } = props;
  const steps = buildAgentTraceSteps(props);

  return <section className={className} style={panelStyle} aria-labelledby="agent-trace-title">
    <header style={{ display: 'flex', gap: 14, justifyContent: 'space-between', alignItems: 'start', borderBottom: '1px solid #d9d4c8', paddingBottom: 14 }}>
      <div>
        <p style={{ margin: 0, color: '#667268', fontSize: 11, fontWeight: 700, letterSpacing: '.14em' }}>DECISION TRACE · 可审计过程</p>
        <h3 id="agent-trace-title" style={{ margin: '7px 0 0', fontFamily: 'Georgia, serif', fontSize: 21 }}>这份推荐是怎样得出的</h3>
      </div>
      <span style={{ whiteSpace: 'nowrap', border: '1px solid #c9c4b7', borderRadius: 999, padding: '5px 8px', color: '#596358', fontSize: 12 }}>{statusCopy[dataStatus]}</span>
    </header>
    <ol style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'grid', gap: 14 }}>
      {steps.map((step) => <li key={step.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', columnGap: 12 }}>
        <span aria-hidden="true" style={{ color: '#a34937', fontSize: 12, fontWeight: 800, letterSpacing: '.05em', paddingTop: 3 }}>{step.index}</span>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}><strong>{step.title}</strong>{step.provenance.map((source) => <span key={source} style={{ ...tagColor[source], border: '1px solid', borderRadius: 999, padding: '2px 6px', fontSize: 11, lineHeight: 1.25 }}>{source}</span>)}</div>
          <p style={{ margin: '5px 0 0', color: '#5e665d', fontSize: 13, lineHeight: 1.65 }}>{step.detail}</p>
        </div>
      </li>)}
    </ol>
    <p role="note" style={{ margin: '18px 0 0', paddingTop: 12, borderTop: '1px dashed #c9c4b7', color: '#7b5440', fontSize: 12, lineHeight: 1.55 }}>说明：动态召回不等于实时地图、交通、价格或预订核验。路线与天气仅在详情页由用户主动按需查询。</p>
  </section>;
}
