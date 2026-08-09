import { useMemo, useState, type CSSProperties } from 'react';
import { Copy, Download, FileDown } from 'lucide-react';
import type { DayPlan, Destination } from '../types';
import type { RouteVerificationStatus } from './DepartureChecklist';
import { buildDecisionPackageMarkdown, decisionPackageFilename } from '../services/decision-package';
import type { WeatherEvidence } from '../services/weather';
import { loadRouteEvidence } from '../services/route-evidence';
import { loadArrivalEvidence } from '../services/arrival-evidence';

type DecisionPackageProps = {
  destination: Destination;
  itinerary: DayPlan[];
  routeStatus?: Partial<Record<number, RouteVerificationStatus>>;
  weatherEvidence?: WeatherEvidence;
  onExport?: () => void;
};

const panel: CSSProperties = { border: '1px solid #315d56', padding: '20px clamp(16px, 3vw, 28px)', background: '#e7eee8', color: '#283129' };
const action: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 38, border: '1px solid #315d56', background: '#fbf8f0', color: '#173f3a', padding: '7px 11px', fontSize: 12 };

/** A user-owned, client-only artifact that makes the plan portable without claiming a booking. */
export default function DecisionPackage({ destination, itinerary, routeStatus, weatherEvidence, onExport }: DecisionPackageProps) {
  const [notice, setNotice] = useState('');
  const buildPackage = () => buildDecisionPackageMarkdown({ destination, itinerary, routeStatus, weatherEvidence, routeEvidence: loadRouteEvidence(destination.id, itinerary), arrivalEvidence: loadArrivalEvidence(destination.id) });
  const markdown = useMemo(buildPackage, [destination, itinerary, routeStatus, weatherEvidence]);
  const exported = () => { onExport?.(); setNotice('已生成决策包；请在出发前继续完成待核验事项。'); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(buildPackage()); exported(); }
    catch { setNotice('当前环境无法直接复制；请下载 Markdown 文件。'); }
  };
  const download = () => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([buildPackage()], { type: 'text/markdown;charset=utf-8' }));
    link.href = url;
    link.download = decisionPackageFilename(destination);
    link.click();
    URL.revokeObjectURL(url);
    exported();
  };
  return <section style={panel} aria-labelledby="decision-package-title">
    <p style={{ margin: 0, color: '#315d56', fontSize: 11, fontWeight: 700, letterSpacing: '.14em' }}>TAKEAWAY · 可带走的决策产物</p>
    <h3 id="decision-package-title" style={{ margin: '7px 0', fontFamily: 'Georgia, serif', fontSize: 22 }}>把方案带走，再决定是否出发</h3>
    <p style={{ maxWidth: 620, margin: '0 0 14px', color: '#52645c', fontSize: 13, lineHeight: 1.6 }}>导出内容包含每日 POI、地图入口、当前道路路线状态与待确认事项；不包含原始委托、上传媒体、预订或价格信息。</p>
    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}><button type="button" style={action} onClick={() => void copy()}><Copy size={15} />复制 Markdown</button><button type="button" style={{ ...action, background: '#315d56', color: '#fff' }} onClick={download}><Download size={15} />下载决策包</button></div>
    <p role="status" aria-live="polite" style={{ minHeight: 20, margin: '12px 0 0', color: '#315d56', fontSize: 12 }}>{notice || <><FileDown size={14} style={{ verticalAlign: 'text-bottom' }} /> 生成后仍需逐项完成出发前核验。</>}</p>
  </section>;
}
