import { useCallback, useState, type CSSProperties } from 'react';
import { getFunnel, reset, type Funnel } from '../services/session-analytics';

export type DecisionDataMode = 'online' | 'demo' | 'offline';

export type DecisionStatsProps = {
  /** The state of the preference parser for the current planning session. */
  dataMode?: DecisionDataMode;
  /** Receives the refreshed local-only funnel; no event data is transmitted. */
  onRefresh?: (funnel: Funnel) => void;
  /** Receives the empty funnel immediately after this session's ledger is cleared. */
  onReset?: (funnel: Funnel) => void;
  className?: string;
};

export type DecisionStage = {
  id: 'submitted' | 'candidates' | 'detail' | 'action';
  label: string;
  count: number;
  eventNames: string;
};

const modeCopy: Record<DecisionDataMode, { label: string; note: string; color: string; background: string }> = {
  online: { label: '在线偏好解析', note: '候选与路线仍可能来自静态编辑库。', color: '#24533d', background: '#e4f0e6' },
  demo: { label: '本地演示数据', note: '在线解析未作为本次结果的依据。', color: '#765320', background: '#f9eed6' },
  offline: { label: '离线演示', note: '当前未调用在线服务。', color: '#7a4437', background: '#fae9e4' },
};

const panelStyle: CSSProperties = {
  border: '1px solid #c9c4b7', borderRadius: 14, background: '#f8f5ed', color: '#283129',
  padding: '20px clamp(16px, 3vw, 28px)', boxShadow: '0 10px 30px rgba(45, 47, 39, .07)',
};

export function buildDecisionStages(funnel: Funnel): DecisionStage[] {
  return [
    { id: 'submitted', label: '提交委托', count: funnel.counts.brief_submitted, eventNames: 'brief_submitted' },
    { id: 'candidates', label: '查看候选', count: funnel.counts.candidates_viewed, eventNames: 'candidates_viewed' },
    { id: 'detail', label: '打开详情', count: funnel.counts.destination_selected, eventNames: 'destination_selected' },
    {
      id: 'action', label: '行动 / 决策',
      count: funnel.counts.itinerary_shared + funnel.counts.decision_package_exported + funnel.counts.navigation_opened + funnel.counts.plan_adopted + funnel.counts.plan_rejected,
      eventNames: 'itinerary_shared + decision_package_exported + navigation_opened + plan_adopted + plan_rejected',
    },
  ];
}

export function completedDecisionStages(funnel: Funnel) {
  return buildDecisionStages(funnel).filter((stage) => stage.count > 0).length;
}

/**
 * A local session ledger for validating product instrumentation. It deliberately
 * does not claim that the numbers represent real users or production analytics.
 */
export default function DecisionStats({ dataMode = 'demo', onRefresh, onReset, className }: DecisionStatsProps) {
  const [funnel, setFunnel] = useState<Funnel>(() => getFunnel());
  const [message, setMessage] = useState('已读取当前浏览器会话的本地记录。');
  const stages = buildDecisionStages(funnel);
  const completed = completedDecisionStages(funnel);
  const mode = modeCopy[dataMode];

  const refresh = useCallback(() => {
    const next = getFunnel();
    setFunnel(next);
    setMessage('统计已刷新，仅包含当前浏览器会话。');
    onRefresh?.(next);
  }, [onRefresh]);

  const clear = useCallback(() => {
    reset();
    const next = getFunnel();
    setFunnel(next);
    setMessage('本次会话的本地统计已重置。');
    onReset?.(next);
  }, [onReset]);

  return <section className={className} style={panelStyle} aria-labelledby="decision-stats-title">
    <header style={{ display: 'flex', gap: 14, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', borderBottom: '1px solid #d9d4c8', paddingBottom: 14 }}>
      <div>
        <p style={{ margin: 0, color: '#667268', fontSize: 11, fontWeight: 700, letterSpacing: '.14em' }}>SESSION LEDGER · 本次决策统计</p>
        <h3 id="decision-stats-title" style={{ margin: '7px 0 0', fontFamily: 'Georgia, serif', fontSize: 21 }}>从委托到行动的本地漏斗</h3>
      </div>
      <span style={{ borderRadius: 999, padding: '5px 8px', color: mode.color, background: mode.background, fontSize: 12, fontWeight: 700 }}>{mode.label}</span>
    </header>

    <p style={{ margin: '14px 0 0', color: '#5e665d', fontSize: 13, lineHeight: 1.6 }}>
      已完成 <strong>{completed} / {stages.length}</strong> 个决策阶段。{mode.note}
    </p>

    <ol aria-label="本次决策漏斗" style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
      {stages.map((stage, index) => {
        const hasData = stage.count > 0;
        return <li key={stage.id} style={{ minWidth: 0, padding: '12px 10px', border: `1px solid ${hasData ? '#adc4b3' : '#d9d4c8'}`, borderRadius: 10, background: hasData ? '#edf4ed' : '#fbf9f4' }}>
          <span aria-hidden="true" style={{ color: '#8d5c3a', fontSize: 11, fontWeight: 800, letterSpacing: '.08em' }}>{String(index + 1).padStart(2, '0')}</span>
          <strong style={{ display: 'block', marginTop: 6, fontSize: 14 }}>{stage.label}</strong>
          <data value={stage.count} aria-label={`${stage.label} ${stage.count} 次`} style={{ display: 'block', marginTop: 8, fontFamily: 'Georgia, serif', color: hasData ? '#234336' : '#687168', fontSize: 26, lineHeight: 1 }}>{stage.count}</data>
          <span style={{ display: 'block', marginTop: 7, color: '#71776f', fontSize: 10, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{stage.eventNames}</span>
        </li>;
      })}
    </ol>

    <p role="note" style={{ margin: '18px 0 0', padding: '10px 12px', borderLeft: '3px solid #b67a52', background: '#f2eee4', color: '#6b5949', fontSize: 12, lineHeight: 1.6 }}>
      本地模拟埋点，不代表线上用户。记录仅保留在当前浏览器会话，用于验证产品漏斗设计；不会发送原始委托、文件名或定位信息。
    </p>
    <p role="status" aria-live="polite" style={{ minHeight: '1.5em', margin: '10px 0 0', color: '#526054', fontSize: 12 }}>{message}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
      <button type="button" onClick={refresh} style={{ cursor: 'pointer', border: '1px solid #9ca99c', borderRadius: 8, padding: '8px 11px', background: 'transparent', color: '#284032', fontWeight: 700 }}>刷新统计</button>
      <button type="button" onClick={clear} style={{ cursor: 'pointer', border: '1px solid #c3a49a', borderRadius: 8, padding: '8px 11px', background: 'transparent', color: '#7a4437', fontWeight: 700 }}>重置本次统计</button>
    </div>
  </section>;
}
