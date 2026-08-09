import type { CSSProperties } from 'react';
import type { DayPlan, Destination } from '../types';
import { buildCatalogHealthReport, type CatalogHealthOptions } from '../services/catalog-health';

export type DataEvidencePanelProps = CatalogHealthOptions & {
  destination: Destination;
  itinerary?: DayPlan[];
  className?: string;
};

const panel: CSSProperties = { border: '1px solid #c9c4b7', borderRadius: 14, padding: '20px clamp(16px, 3vw, 28px)', background: '#f6f2e8', color: '#283129' };
const badge: CSSProperties = { display: 'inline-block', border: '1px solid #ad6a4c', color: '#703d27', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em' };

function freshnessLabel(value: ReturnType<typeof buildCatalogHealthReport>['freshness']) {
  return value === 'current' ? '编辑日期在阈值内（仍非实时）' : value === 'stale' ? '编辑日期已超过健康阈值' : '日期不完整，无法判断健康度';
}

/** A provenance panel: it reports static editorial evidence, never live availability or navigation facts. */
export default function DataEvidencePanel({ destination, itinerary, now, staleAfterDays, className }: DataEvidencePanelProps) {
  const report = buildCatalogHealthReport(destination, itinerary ?? destination.itinerary, { now, staleAfterDays });
  return <section className={className} style={panel} aria-labelledby="data-evidence-title">
    <header style={{ display: 'grid', gap: 8, borderBottom: '1px solid #d9d4c8', paddingBottom: 14 }}>
      <p style={{ margin: 0, color: '#667268', fontSize: 11, fontWeight: 700, letterSpacing: '.14em' }}>EVIDENCE LEDGER · 数据健康度</p>
      <h3 id="data-evidence-title" style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: 21 }}>行程数据与证据</h3>
      <span style={badge}>{report.dataLabel}</span>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#5e665d' }}>{report.knownSummary}</p>
    </header>
    <section aria-labelledby="known-data-title" style={{ marginTop: 18 }}>
      <h4 id="known-data-title" style={{ margin: '0 0 8px' }}>已知</h4>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, margin: 0 }}>
        <div><dt>POI 总数</dt><dd style={{ margin: '3px 0 0', fontWeight: 700 }}>{report.poiCount}</dd></div>
        <div><dt>唯一证据来源</dt><dd style={{ margin: '3px 0 0', fontWeight: 700 }}>{report.uniqueEvidenceSourceCount}</dd></div>
        <div><dt>最早更新日</dt><dd style={{ margin: '3px 0 0', fontWeight: 700 }}>{report.earliestUpdatedAt ?? '未提供'}</dd></div>
        <div><dt>最新更新日</dt><dd style={{ margin: '3px 0 0', fontWeight: 700 }}>{report.latestUpdatedAt ?? '未提供'}</dd></div>
      </dl>
      <p role="status" style={{ margin: '14px 0 0', fontSize: 13, color: '#5e665d' }}>{freshnessLabel(report.freshness)}；阈值为 {report.staleAfterDays} 天。</p>
      {(report.missingUpdatedAtCount || report.invalidUpdatedAtCount) ? <p role="alert" style={{ margin: '8px 0 0', color: '#8a4932', fontSize: 13 }}>更新时间问题：缺失 {report.missingUpdatedAtCount} 条，格式无效 {report.invalidUpdatedAtCount} 条。</p> : null}
      <h5 style={{ margin: '16px 0 6px' }}>来源外链</h5>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{report.evidenceSources.map((source) => <li key={`${source.label}-${source.url}`} style={{ margin: '6px 0' }}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> <small>（编辑日期：{source.updatedAt || '未提供'}）</small></li>)}</ul>
    </section>
    <section aria-labelledby="verification-title" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #d9d4c8' }}>
      <h4 id="verification-title" style={{ margin: '0 0 8px' }}>出发前核验</h4>
      <p style={{ margin: 0, color: '#5e665d', fontSize: 13, lineHeight: 1.6 }}>{report.verificationSummary}</p>
      <p style={{ margin: '10px 0 0', color: '#8a4932', fontSize: 13 }}>高风险事项 {report.highRiskCount} 条：{report.highRiskPois.length ? report.highRiskPois.map((poi) => poi.name).join('、') : '当前静态数据未标注具体事项'}。</p>
    </section>
  </section>;
}
