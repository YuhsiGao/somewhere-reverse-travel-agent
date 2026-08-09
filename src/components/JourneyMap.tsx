import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LngLatBounds, Map as MapLibre, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geometryFor, type GeoPoint } from '../data/geography';
import type { DayPlan, Destination } from '../types';
import type { RouteEvidence } from '../services/route-evidence';

type Props = {
  places: Destination[];
  selected: Destination | null;
  /** The itinerary currently chosen by the planner. Falls back to selected.itinerary. */
  itinerary?: DayPlan[];
  onSelect: (place: Destination) => void;
  /**
   * Reports only the user's current-day verification state. It deliberately
   * excludes coordinates, POIs, provider payloads, and the selected place.
   */
  onRouteVerificationChange?: (change: RouteVerificationChange) => void;
};

const EMPTY_ITINERARY: DayPlan[] = [];
type MapPoi = { id: string; day: number; order: number; title: string; detail: string; time: string; coordinate: GeoPoint };
export type AccessibleMapItem = { id: string; label: string };
export type VerifiedLegRoute = { legId: string; coordinates: GeoPoint[] };
export type RouteVerificationStatus = 'verified' | 'failed' | 'unavailable' | 'not-requested';
export type RouteVerificationChange = { day: number; status: RouteVerificationStatus; evidence?: RouteEvidence };
export type MapHealth = 'loading' | 'ready' | 'degraded';
type RouteCheck =
  | { status: 'idle' }
  | { status: 'loading'; completedLegs: number; totalLegs: number }
  | { status: 'success'; routes: VerifiedLegRoute[]; sourceLabel: string; plannedAt: string }
  | { status: 'failure'; reason: string };

/** Maps classified routing outcomes to the compact, host-safe callback contract. */
export function routeVerificationStatusForRoutingResult(status: string): RouteVerificationStatus {
  if (status === 'ok') return 'verified';
  if (status === 'unsupported' || status === 'timeout' || status === 'service-error') return 'unavailable';
  return status === 'cancelled' ? 'not-requested' : 'failed';
}

export function mapHealthCopy(status: MapHealth) {
  if (status === 'ready') return '可缩放 · 点选坐标';
  if (status === 'degraded') return '地图暂不可用 · 可继续浏览地点列表';
  return '正在准备交互地图';
}

export function routeVerificationProgressLabel(completedLegs: number, totalLegs: number) {
  return `正在核验第 ${Math.min(completedLegs + 1, totalLegs)} / ${totalLegs} 段道路路线…`;
}

// Kept in-component because this task deliberately does not alter the visual map or global CSS.
// These controls remain in the accessibility tree and receive keyboard focus without adding a
// second visual UI beside the map.
const visuallyHidden: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
};

// A deliberately quiet raster base: it remains available without a map key. The paper
// treatment and data layers below turn it into a geographic reference, not a navigation UI.
const mapStyle = {
  version: 8 as const,
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm', paint: { 'raster-opacity': 0.74, 'raster-saturation': -0.75, 'raster-contrast': -0.22, 'raster-brightness-max': 0.89 } }],
};

export function poisForItinerary(itinerary: DayPlan[]): MapPoi[] {
  return itinerary.flatMap((day) => day.pois.map((poi, index) => ({
    id: poi.id,
    day: day.day,
    order: index + 1,
    title: poi.name,
    detail: poi.whyItFits,
    time: `建议停留约 ${poi.stayMinutes} 分钟`,
    coordinate: poi.coordinates,
  })));
}

export function accessiblePlaceItems(places: Destination[]): AccessibleMapItem[] {
  return places.map((place) => ({
    id: place.id,
    label: `在地图上选择${place.city}，${place.region}`,
  }));
}

export function accessiblePoiItems(itinerary: DayPlan[]): AccessibleMapItem[] {
  return poisForItinerary(itinerary).map((poi) => ({
    id: poi.id,
    label: `查看第 ${poi.day} 天第 ${poi.order} 站：${poi.title}。${poi.time}`,
  }));
}

export function routeFeaturesForItinerary(itinerary: DayPlan[]) {
  return itinerary.map((day) => ({
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: day.pois.map((poi) => poi.coordinates) },
    properties: { day: day.day },
  })).filter((feature) => feature.geometry.coordinates.length > 1);
}

export function routeFeaturesForVerifiedLegs(routes: VerifiedLegRoute[]) {
  return routes.map((route) => ({
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: route.coordinates },
    properties: { legId: route.legId },
  })).filter((feature) => feature.geometry.coordinates.length > 1);
}

function updateSource(map: MapLibre, name: string, features: object[]) {
  (map.getSource(name) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
}

function syncMapData(map: MapLibre, places: Destination[], selected: Destination | null, itinerary: DayPlan[], activeDay: number) {
  const placePoints = places.map((place) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: geometryFor(place).center },
    properties: { id: place.id, selected: place.id === selected?.id },
  }));
  const allRoutes = routeFeaturesForItinerary(itinerary);
  const visibleRoute = activeDay ? allRoutes.filter((feature) => feature.properties.day === activeDay) : allRoutes;
  const poiFeatures = selected ? poisForItinerary(itinerary).filter((poi) => !activeDay || poi.day === activeDay).map((poi) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: poi.coordinate },
    properties: { id: poi.id, day: poi.day, order: poi.order, active: poi.day === activeDay },
  })) : [];

  updateSource(map, 'somewhere-places', placePoints);
  updateSource(map, 'somewhere-route', allRoutes);
  updateSource(map, 'somewhere-route-active', visibleRoute);
  updateSource(map, 'somewhere-day-pois', poiFeatures);

  if (selected) {
    const bounds = new LngLatBounds();
    poisForItinerary(itinerary).filter((poi) => !activeDay || poi.day === activeDay).forEach((poi) => bounds.extend(poi.coordinate));
    map.fitBounds(bounds, { padding: { top: 72, right: 62, bottom: 72, left: 62 }, maxZoom: 12.8, duration: 420 });
    return;
  }
  if (places.length > 1) {
    const bounds = new LngLatBounds();
    places.forEach((place) => bounds.extend(geometryFor(place).center));
    map.fitBounds(bounds, { padding: 70, maxZoom: 3.4, duration: 0 });
  }
}

function dayCopy(day: DayPlan | undefined, activeDay: number) {
  if (!day) return activeDay ? `DAY ${activeDay}` : '整段路线';
  return `DAY ${day.day} · ${day.theme}`;
}

function coordinatesForLeg(day: DayPlan, leg: DayPlan['travelLegs'][number]): GeoPoint[] | undefined {
  const places = new Map(day.pois.map((poi) => [poi.id, poi.coordinates]));
  const from = places.get(leg.fromPoiId);
  const to = places.get(leg.toPoiId);
  return from && to ? [from, to] : undefined;
}

export function JourneyMap({ places, selected, itinerary, onSelect, onRouteVerificationChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const placesRef = useRef(places);
  const selectedRef = useRef(selected);
  const itineraryRef = useRef<DayPlan[]>(itinerary ?? selected?.itinerary ?? EMPTY_ITINERARY);
  const onSelectRef = useRef(onSelect);
  const onRouteVerificationChangeRef = useRef(onRouteVerificationChange);
  const [ready, setReady] = useState(false);
  const [mapHealth, setMapHealth] = useState<MapHealth>('loading');
  const [mapAttempt, setMapAttempt] = useState(0);
  const [activeDay, setActiveDay] = useState(0);
  const [activePoi, setActivePoi] = useState<MapPoi | null>(null);
  const [routeCheck, setRouteCheck] = useState<RouteCheck>({ status: 'idle' });
  const routeAbortRef = useRef<AbortController | null>(null);
  const activeDayRef = useRef(0);

  // Keep the empty fallback referentially stable. A fresh `[]` here made the
  // reset effect below run after every render when browsing candidates.
  const activeItinerary = itinerary ?? selected?.itinerary ?? EMPTY_ITINERARY;

  useEffect(() => {
    placesRef.current = places;
    selectedRef.current = selected;
    itineraryRef.current = activeItinerary;
    onSelectRef.current = onSelect;
    onRouteVerificationChangeRef.current = onRouteVerificationChange;
  }, [places, selected, activeItinerary, onRouteVerificationChange, onSelect]);

  const reportRouteVerification = (day: number, status: RouteVerificationStatus, evidence?: RouteEvidence) => {
    if (day > 0) onRouteVerificationChangeRef.current?.({ day, status, evidence });
  };

  useEffect(() => {
    const previouslyActiveDay = activeDayRef.current;
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
    reportRouteVerification(previouslyActiveDay, 'not-requested');
    activeDayRef.current = 0;
    setActiveDay(0);
    setActivePoi(null);
    setRouteCheck((current) => current.status === 'idle' ? current : { status: 'idle' });
  }, [selected?.id, activeItinerary]);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let hasLoaded = false;
    setWorkerUrl(workerUrl);
    const map = new MapLibre({
      container: hostRef.current,
      style: mapStyle,
      center: [112, 35],
      zoom: 1.25,
      attributionControl: { compact: true },
    });
    map.on('error', (event) => {
      const sourceId = (event as unknown as { sourceId?: string }).sourceId;
      // A failed OSM raster request leaves the route data usable but removes the
      // geographic base. Map initialization errors also need an honest fallback.
      if (!hasLoaded || sourceId === 'osm') setMapHealth('degraded');
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      hasLoaded = true;
      ['somewhere-places', 'somewhere-route', 'somewhere-route-active', 'somewhere-route-verified', 'somewhere-day-pois'].forEach((name) => map.addSource(name, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }));
      map.addLayer({ id: 'somewhere-route-underlay', type: 'line', source: 'somewhere-route', paint: { 'line-color': '#e9dfcf', 'line-width': 8, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'somewhere-route-muted', type: 'line', source: 'somewhere-route', paint: { 'line-color': '#66847a', 'line-width': 1.5, 'line-opacity': 0.66, 'line-dasharray': [1.1, 1.45] } });
      map.addLayer({ id: 'somewhere-route-active', type: 'line', source: 'somewhere-route-active', paint: { 'line-color': '#bd4935', 'line-width': 3.5, 'line-opacity': 0.98, 'line-dasharray': [1.05, 1.15] } });
      map.addLayer({ id: 'somewhere-route-verified-halo', type: 'line', source: 'somewhere-route-verified', paint: { 'line-color': '#f8f3e8', 'line-width': 7, 'line-opacity': 0.92 } });
      map.addLayer({ id: 'somewhere-route-verified', type: 'line', source: 'somewhere-route-verified', paint: { 'line-color': '#1e5b58', 'line-width': 3.2, 'line-opacity': 0.98 } });
      map.addLayer({ id: 'somewhere-place-halo', type: 'circle', source: 'somewhere-places', paint: { 'circle-radius': ['case', ['get', 'selected'], 13, 9], 'circle-color': '#f8f3e8', 'circle-opacity': 0.94, 'circle-stroke-width': 1, 'circle-stroke-color': '#1e5b58' } });
      map.addLayer({ id: 'somewhere-place-core', type: 'circle', source: 'somewhere-places', paint: { 'circle-radius': ['case', ['get', 'selected'], 5, 3.5], 'circle-color': ['case', ['get', 'selected'], '#bd4935', '#1e5b58'] } });
      map.addLayer({ id: 'somewhere-poi-halo', type: 'circle', source: 'somewhere-day-pois', paint: { 'circle-radius': 14, 'circle-color': '#fbf7ee', 'circle-opacity': 0.96, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#bd4935' } });
      map.addLayer({ id: 'somewhere-poi-core', type: 'circle', source: 'somewhere-day-pois', paint: { 'circle-radius': 5.5, 'circle-color': '#bd4935', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf7ee' } });
      map.addLayer({ id: 'somewhere-poi-order', type: 'symbol', source: 'somewhere-day-pois', layout: { 'text-field': ['to-string', ['get', 'order']], 'text-font': ['Noto Sans Bold'], 'text-size': 9 }, paint: { 'text-color': '#fbf7ee' } });
      map.on('click', 'somewhere-place-halo', (event) => {
        const id = event.features?.[0]?.properties?.id;
        const place = placesRef.current.find((item) => item.id === id);
        if (place) onSelectRef.current(place);
      });
      map.on('click', 'somewhere-poi-halo', (event) => {
        const feature = event.features?.[0];
        if (!feature?.properties) return;
        const poi = selectedRef.current ? poisForItinerary(itineraryRef.current).find((item) => item.id === feature.properties?.id) : undefined;
        if (poi) setActivePoi(poi);
      });
      ['somewhere-place-halo', 'somewhere-poi-halo'].forEach((layer) => {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      });
      mapRef.current = map;
      syncMapData(map, placesRef.current, selectedRef.current, itineraryRef.current, 0);
      setReady(true);
      setMapHealth((current) => current === 'degraded' ? current : 'ready');
    });
    return () => { routeAbortRef.current?.abort(); map.remove(); mapRef.current = null; };
  }, [mapAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    syncMapData(map, places, selected, activeItinerary, activeDay);
  }, [activeDay, activeItinerary, places, ready, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const routes = routeCheck.status === 'success' ? routeFeaturesForVerifiedLegs(routeCheck.routes) : [];
    updateSource(map, 'somewhere-route-verified', routes);
  }, [ready, routeCheck]);

  const chooseDay = (day: number) => {
    const previouslyActiveDay = activeDayRef.current;
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
    reportRouteVerification(previouslyActiveDay, 'not-requested');
    activeDayRef.current = day;
    setRouteCheck({ status: 'idle' });
    reportRouteVerification(day, 'not-requested');
    setActiveDay(day);
    setActivePoi(day && selected ? poisForItinerary(activeItinerary).find((poi) => poi.day === day) ?? null : null);
  };

  const verifyCurrentDayRoute = async () => {
    const day = activeItinerary.find((item) => item.day === activeDay);
    if (!day) {
      setRouteCheck({ status: 'failure', reason: '请先选择需要核验的行程日。' });
      return;
    }
    if (!day.travelLegs.length) {
      setRouteCheck({ status: 'failure', reason: '该日没有可核验的相邻地点路段。' });
      reportRouteVerification(activeDay, 'unavailable');
      return;
    }
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setRouteCheck({ status: 'loading', completedLegs: 0, totalLegs: day.travelLegs.length });

    try {
      // This network module is deliberately requested only after an explicit action.
      // OSRM is a public demonstration provider; production should proxy or self-host it.
      const { getOsrmRoute } = await import('../services/routing');
      const results = [] as Awaited<ReturnType<typeof getOsrmRoute>>[];
      // The public demo backend serializes upstream OSRM calls. Keeping the
      // client sequential matches that boundary, makes cancellation reliable,
      // and tells the traveller which segment is still pending.
      for (const [index, leg] of day.travelLegs.entries()) {
        if (controller.signal.aborted) return;
        setRouteCheck({ status: 'loading', completedLegs: index, totalLegs: day.travelLegs.length });
        const coordinates = coordinatesForLeg(day, leg);
        const result = coordinates
          ? await getOsrmRoute({ coordinates, mode: leg.mode, signal: controller.signal })
          : await getOsrmRoute({ coordinates: [], mode: leg.mode, signal: controller.signal });
        results.push(result);
        if (result.status !== 'ok' || !result.geometry) break;
      }
      if (controller.signal.aborted) return;
      const failed = results.find((result) => result.status !== 'ok' || !result.geometry);
      if (failed) {
        setRouteCheck({ status: 'failure', reason: failed.message || '路线服务未返回可用路网结果。' });
        reportRouteVerification(activeDay, routeVerificationStatusForRoutingResult(failed.status));
        return;
      }
      const successful = results.filter((result) => result.status === 'ok' && result.geometry) as Array<{ geometry: { coordinates: GeoPoint[] }; updatedAt: string }>;
      const missingGeometry = successful.find((result) => result.geometry.coordinates.length < 2);
      if (missingGeometry) {
        setRouteCheck({ status: 'failure', reason: '路线服务返回的路网坐标不完整。' });
        reportRouteVerification(activeDay, 'failed');
        return;
      }
      const first = successful[0];
      setRouteCheck({
        status: 'success',
        routes: successful.map((result, index) => ({ legId: day.travelLegs[index].id, coordinates: result.geometry.coordinates })),
        sourceLabel: '受控路线服务 · OSRM 道路网络（演示）',
        plannedAt: first.updatedAt,
      });
      reportRouteVerification(activeDay, 'verified', {
        provider: 'osrm', checkedAt: first.updatedAt,
        distanceKm: Math.round(results.reduce((total, result) => total + (result.distanceKm ?? 0), 0) * 100) / 100,
        durationMinutes: results.reduce((total, result) => total + (result.durationMinutes ?? 0), 0),
        legCount: results.length,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setRouteCheck({ status: 'failure', reason: error instanceof Error ? error.message : '路线核验暂不可用。' });
      reportRouteVerification(activeDay, 'unavailable');
    }
  };

  const choosePoi = (poi: MapPoi) => {
    setActiveDay(poi.day);
    setActivePoi(poi);
  };

  const mapPlaces = accessiblePlaceItems(places);
  const mapPois = selected ? poisForItinerary(activeItinerary) : [];
  const retryMap = () => { setReady(false); setMapHealth('loading'); setMapAttempt((attempt) => attempt + 1); };

  return <section className="journey-map" aria-label="候选目的地交互地图">
    <div className="journey-map-head">
      <div><span className="section-kicker">FIELD MAP / ROUTE</span><h3>{selected ? `${selected.city} · 行走路线档案` : '在地理档案里，比较候选去处'}</h3></div>
      <span className="map-status"><i /> {mapHealthCopy(mapHealth)}</span>
    </div>
    <div className="journey-map-canvas" ref={hostRef}>
      <div className="map-paper-grain" aria-hidden="true" />
      <div className="map-coordinate map-coordinate-north" aria-hidden="true">N / FIELD NOTE</div>
      <div className="map-coordinate map-coordinate-scale" aria-hidden="true">01 — 03</div>
      {mapHealth === 'loading' && <div className="map-load-note" role="status">正在加载地图底图与路线图层…</div>}
      {mapHealth === 'degraded' && <aside className="map-degraded-note" role="status"><strong>地图暂不可用</strong><p>可能是网络或地图底图服务暂时不可达。编辑行程、路线文本和地点列表仍可使用。</p><button type="button" onClick={retryMap}>重新尝试地图</button></aside>}
      {activePoi && <aside className="map-poi-card" aria-live="polite">
        <span>DAY 0{activePoi.day} / ROUTE NOTE</span>
        <strong>{activePoi.title}</strong>
        <p>{activePoi.detail}</p>
        <small>{activePoi.time}</small>
        <button type="button" onClick={() => setActivePoi(null)} aria-label="关闭地点信息">×</button>
      </aside>}
    </div>
    <div aria-label="候选地点地图等价操作" style={visuallyHidden}>
      <p>候选地点列表。选择地点会同步更新地图和方案详情。</p>
      {mapPlaces.map((item) => {
        const place = places.find((candidate) => candidate.id === item.id);
        return place ? <button key={item.id} type="button" aria-pressed={selected?.id === item.id} onClick={() => onSelect(place)}>{item.label}</button> : null;
      })}
    </div>
    {selected && <div aria-label="选中行程地点地图等价操作" style={visuallyHidden}>
      <p>行程地点列表。选择地点会同步展开相应日期路线与地点注记。</p>
      {mapPois.map((poi) => {
        const item = accessiblePoiItems(activeItinerary).find((candidate) => candidate.id === poi.id);
        return <button key={poi.id} type="button" aria-current={activePoi?.id === poi.id ? 'true' : undefined} onClick={() => choosePoi(poi)}>{item?.label}</button>;
      })}
    </div>}
    <details className="map-browser-list">
      <summary>按列表浏览{selected ? '行程地点' : '候选地点'}</summary>
      <p>{selected ? '选择站点会展开对应日期与地点注记。' : '选择地点会同步打开对应路线与方案详情。'}</p>
      <div>{(selected ? mapPois : mapPlaces).map((item) => {
        if (selected) {
          const poi = mapPois.find((candidate) => candidate.id === item.id);
          return poi ? <button key={item.id} type="button" onClick={() => choosePoi(poi)}>第 {poi.day} 天 · {poi.title}</button> : null;
        }
        const place = places.find((candidate) => candidate.id === item.id);
        return place ? <button key={item.id} type="button" onClick={() => onSelect(place)}>{place.city} · {place.region}</button> : null;
      })}</div>
    </details>
    {mapHealth === 'degraded' && <section className="map-degraded-list" aria-label="地图降级地点列表"><strong>不用地图也可继续浏览</strong><div>{mapPlaces.map((item) => { const place = places.find((candidate) => candidate.id === item.id); return place ? <button key={item.id} type="button" onClick={() => onSelect(place)}>{place.city} · {place.region}</button> : null; })}</div>{selected && <div>{mapPois.map((poi) => <button key={poi.id} type="button" onClick={() => choosePoi(poi)}>第 {poi.day} 天 · {poi.title}</button>)}</div>}</section>}
    {selected && <div className="route-legend">
      <div className="route-controls" aria-label="选择行程天数">
        {[0, ...activeItinerary.map((day) => day.day)].map((day) => <button key={day} className={activeDay === day ? 'active' : ''} onClick={() => chooseDay(day)} aria-pressed={activeDay === day}>{dayCopy(activeItinerary.find((item) => item.day === day), day)}</button>)}
      </div>
      <p><i /> {activeDay ? '朱红线为当日路线；点击圆点查看当日行程注记。' : '选择一天，展开该日路线与停靠注记。'}</p>
      <div aria-live="polite" style={{ marginTop: 12, display: 'grid', gap: 7 }}>
        <button type="button" onClick={verifyCurrentDayRoute} disabled={!activeDay || routeCheck.status === 'loading'} style={{ justifySelf: 'start', border: '1px solid #1e5b58', background: routeCheck.status === 'success' ? '#1e5b58' : '#f8f3e8', color: routeCheck.status === 'success' ? '#fffaf0' : '#1e5b58', borderRadius: 999, padding: '8px 12px', font: 'inherit', cursor: !activeDay || routeCheck.status === 'loading' ? 'wait' : 'pointer', opacity: !activeDay ? 0.52 : 1 }}>
          {routeCheck.status === 'loading' ? '正在核验当前日路线…' : '核验当前日路线'}
        </button>
        {routeCheck.status === 'idle' && <small style={{ color: '#6e695f' }}>按需调用路线服务；未核验时始终展示静态编辑线路。</small>}
        {routeCheck.status === 'loading' && <small>{routeVerificationProgressLabel(routeCheck.completedLegs, routeCheck.totalLegs)} 静态编辑线路仍保留。</small>}
        {routeCheck.status === 'success' && <small style={{ color: '#1e5b58' }}>深绿实线为已核验路网 · 来源：{routeCheck.sourceLabel} · 规划于 {routeCheck.plannedAt}</small>}
        {routeCheck.status === 'failure' && <small style={{ color: '#a13e2e' }}>未生成实时路线：{routeCheck.reason}。已保留静态编辑线路。</small>}
      </div>
    </div>}
  </section>;
}
