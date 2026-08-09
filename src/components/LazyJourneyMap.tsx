import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { DayPlan, Destination } from '../types';

export type JourneyMapProps = {
  places: Destination[];
  selected: Destination | null;
  /** The itinerary currently chosen by the planner. Falls back to selected.itinerary. */
  itinerary?: DayPlan[];
  onSelect: (place: Destination) => void;
};

/**
 * Keeps MapLibre (including its worker and CSS) out of the initial application
 * graph. The request starts only after an explicit user action.
 */
export async function loadJourneyMap() {
  const module = await import('./JourneyMap');
  return { default: module.JourneyMap };
}

const DeferredJourneyMap = lazy(loadJourneyMap);

export function JourneyMapLoadingFallback(): ReactNode {
  return (
    <section className="journey-map map-loading" aria-busy="true" aria-live="polite" aria-label="正在加载交互地图">
      <div className="map-topline"><span>ROUTE ATLAS</span><span>地图组件加载中</span></div>
      <div className="map-legend"><span className="route-swatch active" /> 正在准备可交互路线地图…</div>
    </section>
  );
}

export function JourneyMapLoadPrompt({ onLoad }: { onLoad: () => void }): ReactNode {
  return (
    <section className="journey-map map-loading" aria-label="交互地图尚未加载">
      <div className="journey-map-head">
        <div>
          <span className="eyebrow">ROUTE ATLAS</span>
          <h3>交互路线地图</h3>
        </div>
        <span className="map-status">按需加载</span>
      </div>
      <div className="route-legend">
        <p>地图较大，按需加载不会阻塞你继续浏览候选地点与每日计划。</p>
        <button type="button" onClick={onLoad} aria-describedby="journey-map-load-help">
          加载交互地图
        </button>
      </div>
      <p id="journey-map-load-help" className="visuallyHidden">
        点击后才会下载地图组件；加载期间仍可继续浏览本页候选文本。
      </p>
    </section>
  );
}

/**
 * Drop-in, code-split replacement for JourneyMap. It deliberately preserves
 * the original props so callers need no behavioural changes when migrating.
 */
export function LazyJourneyMap(props: JourneyMapProps) {
  const [shouldLoadMap, setShouldLoadMap] = useState(false);

  if (!shouldLoadMap) {
    return <JourneyMapLoadPrompt onLoad={() => setShouldLoadMap(true)} />;
  }

  return (
    <Suspense fallback={<JourneyMapLoadingFallback />}>
      <DeferredJourneyMap {...props} />
    </Suspense>
  );
}
