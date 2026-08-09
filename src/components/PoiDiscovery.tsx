import { useEffect, useState } from 'react';
import { ExternalLink, MapPinned, RefreshCw } from 'lucide-react';
import type { GeoPoint } from '../types';
import { discoverNearbyPois, POI_DISCOVERY_CATEGORIES, type PoiDiscovery, type PoiDiscoveryCategory } from '../services/poi-discovery';

const categoryLabel: Record<PoiDiscoveryCategory, string> = { park: '公园', cafe: '咖啡', museum: '博物馆', viewpoint: '观景点' };

/** User-triggered OSM discovery; results never alter the editorial itinerary automatically. */
export default function PoiDiscovery({ city, coordinates }: { city: string; coordinates: GeoPoint }) {
  const [category, setCategory] = useState<PoiDiscoveryCategory>('park');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<PoiDiscovery>();
  useEffect(() => { setState('idle'); setResult(undefined); }, [coordinates[0], coordinates[1]]);
  const discover = async () => {
    setState('loading');
    try { setResult(await discoverNearbyPois(coordinates, category)); setState('success'); }
    catch { setResult(undefined); setState('error'); }
  };
  return <section className="poi-discovery" aria-labelledby="poi-discovery-title">
    <div><span className="section-kicker">OSM DISCOVERY · ON DEMAND</span><h3 id="poi-discovery-title">在{city}附近再找一处</h3><p>只在你点击后查询 OpenStreetMap 的附近地图条目。它们是探索候选，不代表营业、预约、安全或已加入行程。</p></div>
    <div className="poi-discovery__controls" role="group" aria-label="附近地点类型">{POI_DISCOVERY_CATEGORIES.map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} aria-pressed={category === item} onClick={() => { setCategory(item); setState('idle'); }}>{categoryLabel[item]}</button>)}<button type="button" className="poi-discovery__search" onClick={() => void discover()} disabled={state === 'loading'}>{state === 'loading' ? <RefreshCw className="spin" size={14} /> : <MapPinned size={14} />}{state === 'loading' ? '正在查找…' : `查找附近${categoryLabel[category]}`}</button></div>
    {state === 'error' && <p className="poi-discovery__error" role="alert">附近地图地点暂时不可用，请稍后重试或使用已有地图外链。</p>}
    {state === 'success' && result && <div className="poi-discovery__results" aria-live="polite">{result.places.length ? <ul>{result.places.map((place) => <li key={`${place.osmType}-${place.osmId}`}><a href={place.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} />{place.name}</a><small>距查询中心约 {place.distanceKm < 1 ? `${Math.round(place.distanceKm * 1000)} m` : `${place.distanceKm.toFixed(1)} km`} · OSM {place.osmType} · 地图探索候选</small></li>)}</ul> : <p>附近没有返回可用地图条目；可换一个类型或使用现有行程。</p>}<small>来源：OpenStreetMap Nominatim · 本次查询</small></div>}
  </section>;
}
