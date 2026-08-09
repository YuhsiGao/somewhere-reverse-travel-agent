import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { DayPlan, Destination } from '../types';

export type RouteVerificationStatus = 'not-requested' | 'verified' | 'unavailable' | 'failed';

export type DepartureChecklistItem = {
  id: string;
  category: 'weather' | 'operating' | 'route' | 'arrival';
  title: string;
  detail: string;
  provenance: '静态编辑风险' | '路线状态' | '出行前人工核验';
};

export type DepartureChecklistProps = {
  destination: Destination;
  itinerary: DayPlan[];
  /** Per-day route verification result supplied by the host. Unspecified days remain unverified. */
  routeStatus?: Partial<Record<number, RouteVerificationStatus>>;
  /** Optional injection keeps the component testable and allows a host to choose its storage boundary. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  className?: string;
};

const categoryLabel = {
  weather: '天气与环境',
  operating: '营业与预约',
  route: '道路与市内移动',
  arrival: '抵达与返程',
} as const;

const statusCopy: Record<RouteVerificationStatus, string> = {
  'not-requested': '尚未请求实时路网；请在地图中主动核验，或出发前使用可靠导航服务确认。',
  verified: '地图中已生成一次道路路线；出发前仍需重新确认路况、施工和交通管制。',
  unavailable: '路线服务目前不可用；请在出发前用可靠导航服务补充核验。',
  failed: '路线服务未生成可用路线；请检查交通方式或改用可靠导航服务核验。',
};

function safeKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'destination';
}

/** Completion is scoped to a specific editorial itinerary, so a changed plan never inherits stale ticks. */
export function departureChecklistStorageKey(destination: Destination, itinerary: DayPlan[]) {
  const itineraryVersion = itinerary.map((day) => `${day.day}:${day.lastUpdated}:${day.pois.map((poi) => poi.id).join(',')}`).join('|');
  return `somewhere.departure-checklist.v1.${safeKeyPart(destination.id)}.${safeKeyPart(itineraryVersion)}`;
}

export function buildDepartureChecklistItems(destination: Destination, itinerary: DayPlan[], routeStatus: Partial<Record<number, RouteVerificationStatus>> = {}): DepartureChecklistItem[] {
  const weatherDays = itinerary.map((day) => ({
    id: `weather-day-${day.day}`,
    category: 'weather' as const,
    title: `第 ${day.day} 天：确认 ${destination.city} 的天气与环境预警`,
    detail: `行程主题「${day.theme}」为静态编辑建议；请在临行前确认降雨、气温、风力及必要预警。`,
    provenance: '出行前人工核验' as const,
  }));
  const operatingPois = itinerary.flatMap((day) => day.pois.map((poi) => ({
    id: `operating-${day.day}-${poi.id}`,
    category: 'operating' as const,
    title: `第 ${day.day} 天：核验「${poi.name}」营业 / 预约`,
    detail: poi.operatingRisk || '编辑库未提供营业风险信息；请通过官方渠道确认开放、预约与票务。',
    provenance: '静态编辑风险' as const,
  })));
  const routeDays = itinerary.map((day) => {
    const status = routeStatus[day.day] ?? 'not-requested';
    return {
      id: `route-day-${day.day}`,
      category: 'route' as const,
      title: `第 ${day.day} 天：核验 ${day.travelLegs.length} 段市内路线`,
      detail: statusCopy[status],
      provenance: '路线状态' as const,
    };
  });
  const arrival = {
    id: 'arrival',
    category: 'arrival' as const,
    title: `确认抵达 ${destination.city} 与返程衔接`,
    detail: `本方案未接入实时班次、票务或接驳数据；请自行确认抵达时间、最后一段交通、住宿入住与返程余量。`,
    provenance: '出行前人工核验' as const,
  };
  return [...weatherDays, ...operatingPois, ...routeDays, arrival];
}

function browserStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadDepartureChecklist(key: string, storage: DepartureChecklistProps['storage'] = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  } catch {
    return [];
  }
}

export function saveDepartureChecklist(key: string, completedIds: string[], storage: DepartureChecklistProps['storage'] = browserStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify([...new Set(completedIds)]));
    return true;
  } catch {
    return false;
  }
}

export function resetDepartureChecklist(key: string, storage: DepartureChecklistProps['storage'] = browserStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const panelStyle: CSSProperties = { border: '1px solid #c9c4b7', borderRadius: 14, padding: '20px clamp(16px, 3vw, 28px)', background: '#f8f5ed', color: '#283129' };
const itemStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'start', padding: '10px 0', borderBottom: '1px solid #e1dbcf' };

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Local-only, human-operated preparation list. It intentionally never asserts
 * that a weather, opening-hour, booking, or road check has occurred in real time.
 */
export default function DepartureChecklist({ destination, itinerary, routeStatus, storage, className }: DepartureChecklistProps) {
  const key = useMemo(() => departureChecklistStorageKey(destination, itinerary), [destination, itinerary]);
  const items = useMemo(() => buildDepartureChecklistItems(destination, itinerary, routeStatus), [destination, itinerary, routeStatus]);
  const validIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const [completedIds, setCompletedIds] = useState<string[]>(() => loadDepartureChecklist(key, storage));

  useEffect(() => {
    const stored = loadDepartureChecklist(key, storage);
    setCompletedIds((previous) => sameIds(previous, stored) ? previous : stored);
  }, [key, storage]);
  useEffect(() => {
    setCompletedIds((previous) => {
      const next = previous.filter((id) => validIds.has(id));
      return sameIds(previous, next) ? previous : next;
    });
  }, [validIds]);

  const completed = completedIds.filter((id) => validIds.has(id));
  const completedSet = new Set(completed);
  const progress = items.length ? Math.round((completed.length / items.length) * 100) : 0;
  const toggle = (id: string) => setCompletedIds((previous) => {
    const next = previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
    saveDepartureChecklist(key, next, storage);
    return next;
  });
  const reset = () => {
    resetDepartureChecklist(key, storage);
    setCompletedIds([]);
  };

  return <section className={className} style={panelStyle} aria-labelledby="departure-checklist-title">
    <header style={{ display: 'grid', gap: 8, borderBottom: '1px solid #d9d4c8', paddingBottom: 14 }}>
      <p style={{ margin: 0, color: '#667268', fontSize: 11, fontWeight: 700, letterSpacing: '.14em' }}>DEPARTURE CHECK · 本地待办</p>
      <h3 id="departure-checklist-title" style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: 21 }}>出发前核验清单</h3>
      <p style={{ margin: 0, color: '#5e665d', fontSize: 13, lineHeight: 1.6 }}>勾选只保存在当前浏览器，不上传。它记录你的准备进度，不代表天气、营业、预约或道路已经获得实时核验。</p>
      <div>
        <label htmlFor="departure-checklist-progress">已完成 {completed.length} / {items.length}</label>
        <progress id="departure-checklist-progress" value={completed.length} max={items.length || 1} aria-valuetext={`已完成 ${completed.length} 项，共 ${items.length} 项`} style={{ display: 'block', width: '100%', marginTop: 5 }} />
        <span aria-live="polite" style={{ fontSize: 12, color: '#667268' }}>{progress}% 完成</span>
      </div>
    </header>
    {(Object.keys(categoryLabel) as Array<DepartureChecklistItem['category']>).map((category) => {
      const categoryItems = items.filter((item) => item.category === category);
      if (!categoryItems.length) return null;
      return <fieldset key={category} style={{ border: 0, padding: 0, margin: '18px 0 0' }}>
        <legend style={{ fontWeight: 700, padding: 0 }}>{categoryLabel[category]}</legend>
        {categoryItems.map((item) => <div key={item.id} style={itemStyle}>
          <input id={`departure-check-${item.id}`} type="checkbox" checked={completedSet.has(item.id)} onChange={() => toggle(item.id)} />
          <label htmlFor={`departure-check-${item.id}`}>
            <strong>{item.title}</strong>
            <span style={{ display: 'block', marginTop: 3, color: '#5e665d', fontSize: 13, lineHeight: 1.55 }}>{item.detail}</span>
            <span style={{ display: 'inline-block', marginTop: 5, color: '#765320', fontSize: 11, border: '1px solid #ddc58d', borderRadius: 999, padding: '1px 6px' }}>{item.provenance}</span>
          </label>
        </div>)}
      </fieldset>;
    })}
    <footer style={{ marginTop: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" onClick={reset}>重置本地勾选</button>
      <small role="note" style={{ color: '#7b5440' }}>清单由静态行程、POI 风险说明和当前路线状态生成；请通过官方渠道或可靠服务完成实际核验。</small>
    </footer>
  </section>;
}
