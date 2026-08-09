import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { DayPlan, Destination } from '../types';
import {
  PLAN_REJECTION_REASONS,
  clearPlanDecision,
  createPlanDecision,
  itineraryVersion,
  loadPlanDecision,
  savePlanDecision,
  type PlanDecision,
  type PlanDecisionStorage,
  type PlanRejectionReason,
} from '../services/plan-decisions';

export type PlanDecisionProps = {
  destination: Pick<Destination, 'id' | 'city'>;
  itinerary: DayPlan[];
  storage?: PlanDecisionStorage;
  className?: string;
  /**
   * A deliberately minimal local interaction signal for the hosting surface.
   * It never includes a destination, city, itinerary, or any free-form text.
   */
  onDecision?: (event: PlanDecisionEvent) => void;
};

export type PlanDecisionEvent =
  | { outcome: 'adopted' }
  | { outcome: 'not-adopted'; reason: PlanRejectionReason }
  | { outcome: 'cleared' };

export const rejectionReasonLabel: Record<PlanRejectionReason, string> = {
  budget: '预算不合适',
  time: '时间不合适',
  transport: '交通不合适',
  vibe: '氛围不符',
  other: '其他原因',
};

const panelStyle: CSSProperties = { border: '1px solid #c9c4b7', borderRadius: 14, padding: '20px clamp(16px, 3vw, 28px)', background: '#f8f5ed', color: '#283129' };
const buttonStyle: CSSProperties = { border: '1px solid #506154', borderRadius: 999, padding: '8px 13px', background: '#fffdf7', color: '#283129', cursor: 'pointer' };

/**
 * Records a human decision about one editorial itinerary, entirely in this
 * browser. It intentionally cannot collect explanations or any raw trip text.
 */
export default function PlanDecision({ destination, itinerary, storage, className, onDecision }: PlanDecisionProps) {
  const version = useMemo(() => itineraryVersion(itinerary), [itinerary]);
  const [decision, setDecision] = useState<PlanDecision | undefined>(() => loadPlanDecision(destination.id, version, storage));
  const [isChoosingRejection, setIsChoosingRejection] = useState(false);
  const [pendingReason, setPendingReason] = useState<PlanRejectionReason | undefined>();
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDecision(loadPlanDecision(destination.id, version, storage));
    setIsChoosingRejection(false);
    setPendingReason(undefined);
    setNotice('');
  }, [destination.id, version, storage]);

  const persist = (next: PlanDecision) => {
    const saved = savePlanDecision(next, storage);
    setDecision(next);
    setNotice(saved ? '已保存到当前浏览器。' : '当前浏览器无法保存；本次选择仍显示在此页面。');
  };
  const reportDecision = (event: PlanDecisionEvent) => {
    try {
      onDecision?.(event);
    } catch {
      // Host-side analytics must never interrupt this local-only decision flow.
    }
  };
  const adopt = () => {
    const next = createPlanDecision(destination.id, version, 'adopted');
    if (next) {
      persist(next);
      reportDecision({ outcome: 'adopted' });
    }
  };
  const reject = () => {
    if (!pendingReason) return;
    const next = createPlanDecision(destination.id, version, 'not-adopted', pendingReason);
    if (next) {
      persist(next);
      reportDecision({ outcome: 'not-adopted', reason: pendingReason });
    }
  };
  const clear = () => {
    const removed = clearPlanDecision(destination.id, version, storage);
    setDecision(undefined);
    setIsChoosingRejection(false);
    setPendingReason(undefined);
    setNotice(removed ? '本地反馈已清除，你可以重新选择。' : '已撤回当前页面的选择；浏览器未提供可清除的本地存储。');
    reportDecision({ outcome: 'cleared' });
  };

  return <section className={className} style={panelStyle} aria-labelledby="plan-decision-title">
    <header style={{ borderBottom: '1px solid #d9d4c8', paddingBottom: 14 }}>
      <p style={{ margin: 0, color: '#667268', fontSize: 11, fontWeight: 700, letterSpacing: '.14em' }}>PLAN DECISION · 本地反馈</p>
      <h3 id="plan-decision-title" style={{ margin: '7px 0 0', fontFamily: 'Georgia, serif', fontSize: 21 }}>这个 {destination.city} 方案，是否适合你？</h3>
      <p style={{ margin: '8px 0 0', color: '#5e665d', fontSize: 13, lineHeight: 1.6 }}>只保存在当前浏览器：目的地 ID、行程版本、采纳结果及一个结构化原因。不会保存你的文字委托、不会上传，也不会联网。</p>
    </header>

    {decision ? <div style={{ padding: '17px 0 2px' }}>
      <p style={{ margin: 0, fontWeight: 700 }}>{decision.outcome === 'adopted' ? '已采纳此方案' : `暂不采纳：${rejectionReasonLabel[decision.reason!]}`}</p>
      <p style={{ margin: '6px 0 14px', color: '#5e665d', fontSize: 13, lineHeight: 1.55 }}>这是可恢复的本地记录，不会改变推荐结果，也不会向任何服务发送反馈。</p>
      <button type="button" onClick={clear} style={buttonStyle}>撤回并清除本地反馈</button>
    </div> : <div style={{ paddingTop: 17 }}>
      <div role="group" aria-label="方案采纳决定" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={adopt} style={{ ...buttonStyle, background: '#2f4b39', color: '#fffdf7' }}>采纳这个方案</button>
        <button type="button" onClick={() => setIsChoosingRejection(true)} style={buttonStyle}>暂不采纳</button>
      </div>
      {isChoosingRejection && <fieldset style={{ border: '1px solid #dfd8cb', borderRadius: 10, margin: '16px 0 0', padding: '13px 14px' }}>
        <legend style={{ padding: '0 4px', fontWeight: 700 }}>请选择一个原因 <span aria-hidden="true">*</span></legend>
        <p id="plan-decision-reason-help" style={{ margin: '0 0 9px', color: '#5e665d', fontSize: 13 }}>仅记录下面的枚举项，不提供自由文本输入。</p>
        {PLAN_REJECTION_REASONS.map((reason) => <label key={reason} style={{ display: 'block', padding: '5px 0' }}>
          <input type="radio" name={`plan-decision-${destination.id}`} value={reason} checked={pendingReason === reason} onChange={() => setPendingReason(reason)} aria-describedby="plan-decision-reason-help" /> {rejectionReasonLabel[reason]}
        </label>)}
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={reject} disabled={!pendingReason} style={{ ...buttonStyle, cursor: pendingReason ? 'pointer' : 'not-allowed', opacity: pendingReason ? 1 : .55 }}>确认暂不采纳</button>
          <button type="button" onClick={() => { setIsChoosingRejection(false); setPendingReason(undefined); }} style={buttonStyle}>取消</button>
        </div>
      </fieldset>}
    </div>}
    <p aria-live="polite" style={{ minHeight: 20, margin: '12px 0 0', color: '#765320', fontSize: 13 }}>{notice}</p>
  </section>;
}
