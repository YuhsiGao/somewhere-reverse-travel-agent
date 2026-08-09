import { useEffect, useMemo, useState } from 'react';
import { CarFront, CircleAlert, ExternalLink, RefreshCw, Route } from 'lucide-react';
import type { Destination, GeoPoint } from '../types';
import { getOsrmRoute, type RouteResult } from '../services/routing';
import type { TransportPreference } from '../App';
import { saveArrivalEvidence } from '../services/arrival-evidence';

const departurePoints: Record<string, GeoPoint> = {
  上海: [121.4737, 31.2304], 北京: [116.4074, 39.9042], 广州: [113.2644, 23.1291], 成都: [104.0665, 30.5728],
};
export const RAILWAY_OFFICIAL_SEARCH_URL = 'https://www.12306.cn/index/';

export type ArrivalRouteState = 'needs-departure' | 'needs-mode' | 'unsupported-mode' | 'ready' | 'loading' | 'success' | 'failure';

export function arrivalRouteState(departure: string, transport: TransportPreference): ArrivalRouteState {
  if (!departurePoints[departure]) return 'needs-departure';
  if (transport === 'undecided') return 'needs-mode';
  if (transport !== 'drive') return 'unsupported-mode';
  return 'ready';
}

function resultMessage(result: RouteResult) {
  if (result.status === 'ok') return `道路距离约 ${result.distanceKm} km · 预计 ${result.durationMinutes} 分钟`;
  return result.message || '暂时无法生成道路抵达路线，请使用可靠导航服务复核。';
}

/** A deliberately narrow arrival leg: only real road routing is offered today. */
export default function ArrivalRouteCheck({ destination, departure, transport }: { destination: Destination; departure: string; transport: TransportPreference }) {
  const initialState = arrivalRouteState(departure, transport);
  const [state, setState] = useState<ArrivalRouteState>(initialState);
  const [result, setResult] = useState<RouteResult>();
  const canCheck = initialState === 'ready';
  useEffect(() => { setState(arrivalRouteState(departure, transport)); setResult(undefined); }, [departure, transport, destination.id]);
  const from = useMemo(() => departurePoints[departure], [departure]);
  const verify = async () => {
    if (!from) return;
    setState('loading');
    const next = await getOsrmRoute({ coordinates: [from, destination.coordinates], mode: 'drive' });
    if (next.status === 'ok' && next.distanceKm !== null && next.durationMinutes !== null) {
      saveArrivalEvidence(destination.id, { provider: 'osrm', checkedAt: next.updatedAt, departure, transport: 'drive', distanceKm: next.distanceKm, durationMinutes: next.durationMinutes });
    }
    setResult(next); setState(next.status === 'ok' ? 'success' : 'failure');
  };
  const fallback = state === 'needs-departure' ? '选择上海、北京、广州或成都后，可按需核验自驾抵达段。'
    : state === 'needs-mode' ? '请选择交通偏好。当前仅能核验自驾道路抵达段。'
      : state === 'unsupported-mode' ? `已选择${transport === 'rail' ? '高铁 / 火车' : transport === 'flight' ? '飞机' : '公共交通'}；班次、票务与换乘服务尚未接入，不能生成抵达路线。`
        : '';
  return <section className="arrival-route-check" aria-labelledby="arrival-route-title">
    <div><span className="section-kicker">ARRIVAL LEG · ON DEMAND</span><h3 id="arrival-route-title">抵达 {destination.city} 的第一段</h3><p>市内行程与跨城抵达分开处理。只有明确请求过的道路路线才会显示为已核验。</p></div>
    {canCheck && <div className="arrival-route-check__action"><p><CarFront size={15} /> 从 {departure} 自驾至 {destination.city}</p><button type="button" onClick={() => void verify()} disabled={state === 'loading'}>{state === 'loading' ? <RefreshCw className="spin" size={14} /> : <Route size={14} />}{state === 'loading' ? '正在核验抵达路线…' : '核验自驾抵达路线'}</button></div>}
    {fallback && <p className="arrival-route-check__notice"><CircleAlert size={15} />{fallback}</p>}
    {state === 'unsupported-mode' && transport === 'rail' && <p className="arrival-route-check__official"><a href={RAILWAY_OFFICIAL_SEARCH_URL} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 去 12306 查询班次与票务</a><small>将由官方页面确认；本产品未读取、核验或保存班次与票务。</small></p>}
    {result && <p className={state === 'success' ? 'arrival-route-check__result' : 'arrival-route-check__error'} aria-live="polite"><b>{state === 'success' ? '本次道路路线已生成' : '抵达路线未生成'}</b><span>{resultMessage(result)}</span><small>{state === 'success' ? `来源：OSRM 道路网络（演示）· ${result.updatedAt}` : '请改用可靠导航服务或在临近出发时重试。'}</small></p>}
  </section>;
}
