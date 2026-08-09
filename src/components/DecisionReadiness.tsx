import { useEffect, useState, type CSSProperties } from 'react';
import type { DayPlan, Destination } from '../types';
import type { WeatherEvidence } from '../services/weather';
import { isWeatherEvidenceFresh } from '../services/weather';
import { loadRouteEvidence } from '../services/route-evidence';
import { loadArrivalEvidence } from '../services/arrival-evidence';

export type ReadinessSnapshot = { score: number; weather: boolean; verifiedDays: number; totalDays: number; arrival: boolean };

export function decisionReadiness(itinerary: DayPlan[], weatherEvidence?: WeatherEvidence, routeEvidence: Partial<Record<number, unknown>> = {}, arrivalEvidence?: unknown, now: Date = new Date()): ReadinessSnapshot {
  const totalDays = itinerary.length;
  const verifiedDays = itinerary.filter((day) => Boolean(routeEvidence[day.day])).length;
  const weather = isWeatherEvidenceFresh(weatherEvidence, now);
  const arrival = Boolean(arrivalEvidence);
  const score = Math.round((weather ? 25 : 0) + (totalDays ? (verifiedDays / totalDays) * 50 : 0) + (arrival ? 25 : 0));
  return { score, weather, verifiedDays, totalDays, arrival };
}

const sectionStyle: CSSProperties = { margin: '26px 0', padding: '19px 7%', borderTop: '1px solid #c9c4b7', borderBottom: '1px solid #c9c4b7', background: '#eef1e8' };
const stateStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 15 };

/** Turns scattered, user-triggered evidence into coverage, never a booking/readiness guarantee. */
export default function DecisionReadiness({ destination, itinerary, weatherEvidence }: { destination: Destination; itinerary: DayPlan[]; weatherEvidence?: WeatherEvidence }) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((revision) => revision + 1);
    window.addEventListener('somewhere:evidence-updated', refresh);
    return () => window.removeEventListener('somewhere:evidence-updated', refresh);
  }, []);
  const routes = loadRouteEvidence(destination.id, itinerary);
  const arrival = loadArrivalEvidence(destination.id);
  const state = decisionReadiness(itinerary, weatherEvidence, routes, arrival);
  const copy = state.score === 100 ? '三类按需证据已齐全；静态 POI 的营业、预约、票务与安全仍需逐条确认。'
    : state.score >= 50 ? '已有部分证据。补齐缺失项后再决定是否出发。'
      : '当前仍以静态编辑方案为主，先完成关键核验再做出发决定。';
  return <section style={sectionStyle} aria-labelledby="decision-readiness-title">
    <span className="section-kicker">DECISION READINESS · LOCAL EVIDENCE</span>
    <h3 id="decision-readiness-title" style={{ margin: '7px 0 5px', fontFamily: 'Georgia, serif', fontSize: 21 }}>这份方案，已补齐哪些证据？</h3>
    <p style={{ margin: 0, color: '#58645c', fontSize: 12, lineHeight: 1.65 }}>{copy}</p>
    <div style={stateStyle}>
      <div><b style={{ fontSize: 22, color: '#315d56' }}>{state.score}%</b><small style={{ display: 'block', color: '#58645c' }}>按需证据覆盖度</small></div>
      <div><b style={{ color: state.weather ? '#315d56' : '#765320' }}>{state.weather ? '已查询' : '待查询'}</b><small style={{ display: 'block', color: '#58645c' }}>天气（15 分钟内）</small></div>
      <div><b style={{ color: state.verifiedDays === state.totalDays && state.arrival ? '#315d56' : '#765320' }}>{state.verifiedDays}/{state.totalDays} 日 + {state.arrival ? '抵达已核验' : '抵达待核验'}</b><small style={{ display: 'block', color: '#58645c' }}>道路证据（15 分钟内）</small></div>
    </div>
    <small style={{ display: 'block', marginTop: 12, color: '#765320', lineHeight: 1.5 }}>分数只反映本页由你主动触发的三类证据；它不是“可出发”评分，不代表营业、预约、票务、安全、班次或公共交通已经核验。</small>
  </section>;
}
