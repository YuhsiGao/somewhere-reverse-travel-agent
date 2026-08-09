import { useState } from 'react';
import { ExternalLink, MapPinned, RefreshCw } from 'lucide-react';
import type { TravelPoi } from '../types';
import { PoiReferenceError, type PoiReferenceVerification, verifyPoiReference } from '../services/poi-verification';

export default function PoiReferenceCheck({ poi }: { poi: TravelPoi }) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [reference, setReference] = useState<PoiReferenceVerification>();
  const check = async () => {
    setState('loading');
    try {
      setReference(await verifyPoiReference(poi.name, poi.coordinates));
      setState('success');
    } catch (error) {
      setReference(undefined);
      setState('error');
      if (!(error instanceof PoiReferenceError)) setState('error');
    }
  };
  return <div className="poi-reference-check" aria-live="polite">
    <button type="button" onClick={() => void check()} disabled={state === 'loading'}>
      {state === 'loading' ? <RefreshCw className="spin" size={12} /> : <MapPinned size={12} />} {state === 'loading' ? '正在核对地图参照…' : state === 'success' ? '重新核对地图参照' : '核对地图参照'}
    </button>
    {state === 'idle' && <small>按需查询 OpenStreetMap；不核验营业、预约或安全状态。</small>}
    {state === 'error' && <small className="poi-reference-check__error">地图参照暂时不可用；编辑行程保持不变。</small>}
    {state === 'success' && reference && <small className="poi-reference-check__success"><a href={reference.match.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} /> OSM 附近参照</a>：{reference.match.displayName}{reference.match.distanceMeters !== undefined ? ` · 相距约 ${Math.round(reference.match.distanceMeters)} 米` : ''}。仅作地图位置参照。</small>}
  </div>;
}
