import type { DayPlan, Destination, TravelDataSource, TravelPoi } from '../types';

export type CatalogFreshness = 'current' | 'stale' | 'unknown';

export type CatalogHealthOptions = {
  /** Injected for deterministic tests; defaults to the current time. */
  now?: Date;
  /** A valid editorial timestamp older than this is called stale, never "live". */
  staleAfterDays?: number;
};

export type CatalogEvidenceSource = {
  label: string;
  url: string;
  updatedAt: string;
  status: TravelDataSource['status'];
};

export type CatalogHealthReport = {
  destinationId: string;
  poiCount: number;
  uniqueEvidenceSourceCount: number;
  evidenceSources: CatalogEvidenceSource[];
  earliestUpdatedAt?: string;
  latestUpdatedAt?: string;
  missingUpdatedAtCount: number;
  invalidUpdatedAtCount: number;
  highRiskCount: number;
  highRiskPois: Array<{ name: string; operatingRisk: string }>;
  freshness: CatalogFreshness;
  staleAfterDays: number;
  dataLabel: '静态编辑示例，非实时数据' | 'Agent 生成草案，未核验';
  knownSummary: string;
  verificationSummary: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_AFTER_DAYS = 90;
const HIGH_RISK_PATTERN = /未核验|请.*确认|需.*确认|预约|营业|票务|封路|道路|交通|风险/i;

function validDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day) ? undefined : date;
}

function allPois(itinerary: DayPlan[]): TravelPoi[] {
  return itinerary.flatMap((day) => day.pois);
}

function finiteDays(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_STALE_AFTER_DAYS;
}

/**
 * Reads only the editorial plan supplied by the caller. It deliberately has no
 * network dependency and its result must not be presented as a real-time check.
 */
export function buildCatalogHealthReport(destination: Destination, itinerary: DayPlan[] = destination.itinerary, options: CatalogHealthOptions = {}): CatalogHealthReport {
  const now = options.now ?? new Date();
  const staleAfterDays = finiteDays(options.staleAfterDays);
  const pois = allPois(itinerary);
  const sources = pois.map((poi) => poi.source);
  const evidenceByKey = new Map<string, CatalogEvidenceSource>();
  sources.forEach((source) => {
    const key = `${source.label}\u0000${source.url}`;
    if (!evidenceByKey.has(key)) evidenceByKey.set(key, { label: source.label, url: source.url, updatedAt: source.updatedAt, status: source.status });
  });

  let missingUpdatedAtCount = 0;
  let invalidUpdatedAtCount = 0;
  const validUpdates: Array<{ raw: string; date: Date }> = [];
  sources.forEach((source) => {
    const raw = source.updatedAt?.trim() ?? '';
    if (!raw) missingUpdatedAtCount += 1;
    else {
      const parsed = validDate(raw);
      if (parsed) validUpdates.push({ raw, date: parsed });
      else invalidUpdatedAtCount += 1;
    }
  });
  validUpdates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = validUpdates.length ? validUpdates[validUpdates.length - 1] : undefined;
  const freshness: CatalogFreshness = !latest || missingUpdatedAtCount || invalidUpdatedAtCount
    ? 'unknown'
    : now.getTime() - latest.date.getTime() > staleAfterDays * DAY_MS ? 'stale' : 'current';
  const highRiskPois = pois
    .filter((poi) => Boolean(poi.operatingRisk.trim()) && HIGH_RISK_PATTERN.test(poi.operatingRisk))
    .map((poi) => ({ name: poi.name, operatingRisk: poi.operatingRisk }));

  const agentGenerated = sources.some((source) => source.status === 'agent-generated-unverified');
  return {
    destinationId: destination.id,
    poiCount: pois.length,
    uniqueEvidenceSourceCount: evidenceByKey.size,
    evidenceSources: [...evidenceByKey.values()],
    earliestUpdatedAt: validUpdates[0]?.raw,
    latestUpdatedAt: latest?.raw,
    missingUpdatedAtCount,
    invalidUpdatedAtCount,
    highRiskCount: highRiskPois.length,
    highRiskPois,
    freshness,
    staleAfterDays,
    dataLabel: agentGenerated ? 'Agent 生成草案，未核验' : '静态编辑示例，非实时数据',
    knownSummary: agentGenerated ? `本报告只记录 ${pois.length} 个 Agent 体验锚点；它们不是已核验 POI。` : `本报告基于 ${pois.length} 个编辑 POI 与 ${evidenceByKey.size} 个来源条目生成。`,
    verificationSummary: agentGenerated ? '目的地、坐标和体验锚点均来自本次 Agent 生成；请先核验地点存在，再确认营业、预约、票务、天气与道路状态。' : '所有 POI 均为静态编辑示例；营业、预约、票务、天气与道路状态需在出发前自行核验。',
  };
}
