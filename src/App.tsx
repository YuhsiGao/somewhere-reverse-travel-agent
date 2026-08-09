import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ArrowRight, Bookmark, Check, Compass, Globe2, Heart, Info, MapPin, Menu, Send, Settings2, Share2, SlidersHorizontal, Upload, X } from 'lucide-react';
import { LazyJourneyMap as JourneyMap } from './components/LazyJourneyMap';
import MultimodalBrief from './components/MultimodalBrief';
import ConnectionSettingsDialog from './components/ConnectionSettings';
import AgentTrace from './components/AgentTrace';
import DecisionStats from './components/DecisionStats';
import DepartureChecklistBase, { type RouteVerificationStatus } from './components/DepartureChecklist';
import DataEvidencePanel from './components/DataEvidencePanel';
import PlanDecision from './components/PlanDecision';
import PoiReferenceCheck from './components/PoiReferenceCheck';
import DayFeasibility from './components/DayFeasibility';
import WeatherCheck from './components/WeatherCheck';
import DecisionPackage from './components/DecisionPackage';
import type { WeatherEvidence } from './services/weather';
import PoiDiscovery from './components/PoiDiscovery';
import ArrivalRouteCheck from './components/ArrivalRouteCheck';
import DecisionReadiness from './components/DecisionReadiness';
import CandidateComparison from './components/CandidateComparison';
import DetectedConstraintPrompt from './components/DetectedConstraintPrompt';
import { saveRouteEvidence, type RouteEvidence } from './services/route-evidence';
import { destinations, inspirations, vibes } from './data';
import { geometryFor } from './data/geography';
import { interpretWithTokenHub, recallDestinationsWithTokenHub } from './services/remote-agent';
import { destinationFromAgent } from './services/agent-destination';
import { analyzeAuthorizedImage, analyzeAuthorizedImageUrl, MediaInsightError } from './services/media-insight';
import { hasConnectionKey, readConnectionSettings, saveConnectionSettings, type ConnectionSettings } from './services/connection-settings';
import { track } from './services/session-analytics';
import { clearPreferenceProfile, derivePreferenceProfile, rankByPreferenceIncrement, savePreferenceProfile, type PreferenceProfile } from './services/preference-learning';
import type { Destination, Scenario, Status, VibeProfile } from './types';

const steps = ['正在理解你想要的旅行感觉', '正在从世界里召回相似的地方', '正在让三个选择保持不同的角色', '正在标注需要你出发前核验的边界', '已得到 3 个值得去看看的地方'];
const SAVED_STORAGE_KEY = 'somewhere-saved';
const LAST_QUERY_STORAGE_KEY = 'somewhere.last-query.v1';
const REAL_AGENT_ENABLED = import.meta.env.VITE_USE_REAL_AGENT === 'true';
export type Scope = 'any' | 'domestic' | 'abroad';
export type Budget = 'flexible' | 'low' | 'medium';
export type TravelDays = 2 | 3 | 4;
export type TransportPreference = 'undecided' | 'rail' | 'flight' | 'drive' | 'public-transit';

export type CatalogQuery = {
  scope: Scope;
  days: TravelDays;
  budget: Budget;
  departure: string;
  transport: TransportPreference;
  removedTags: string[];
  refinements: string[];
};

export type RoutePlanningState = {
  dayCount: number;
  source: 'editorial-itinerary';
  routingStatus: 'not-connected';
  transportPreference: TransportPreference;
  plannedPoiCount: number;
  plannedLegCount: number;
};

export type DetectedConditions = Partial<Pick<CatalogQuery, 'scope' | 'days' | 'budget' | 'departure' | 'transport'>>;
export type AgentConnectionState = 'idle' | 'online' | 'demo' | 'unavailable' | 'recall-unavailable';
type StoredTravelQuery = Pick<CatalogQuery, 'scope' | 'days' | 'budget' | 'departure' | 'transport'> & { text: string };

/** Keeps programmatic navigation calm when the user has asked for reduced motion. */
export function scrollBehaviorFor(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : 'smooth';
}

const transportLabels: Record<TransportPreference, string> = {
  undecided: '暂不确定', rail: '高铁 / 火车', flight: '飞机', drive: '自驾', 'public-transit': '公共交通',
};
const routeModeLabels = { walk: '步行', bike: '骑行', 'public-transit': '公共交通', drive: '自驾 / 打车', taxi: '打车' } as const;

function DepartureChecklist(props: ComponentProps<typeof DepartureChecklistBase>) {
  const [weatherEvidence, setWeatherEvidence] = useState<WeatherEvidence>();
  const itineraryKey = props.itinerary.map((day) => `${day.day}:${day.lastUpdated}`).join('|');
  useEffect(() => setWeatherEvidence(undefined), [props.destination.id, itineraryKey]);
  const discoveryCoordinates = props.itinerary[0]?.pois[0]?.coordinates ?? props.destination.coordinates;
  return <><DecisionPackage destination={props.destination} itinerary={props.itinerary} routeStatus={props.routeStatus} weatherEvidence={weatherEvidence} onExport={() => track('decision_package_exported')} /><WeatherCheck destination={props.destination} onEvidenceChange={setWeatherEvidence} /><DecisionReadiness destination={props.destination} itinerary={props.itinerary} weatherEvidence={weatherEvidence} /><PoiDiscovery city={props.destination.city} coordinates={discoveryCoordinates} /><DataEvidencePanel destination={props.destination} itinerary={props.itinerary} /><DepartureChecklistBase {...props} /></>;
}

/**
 * The lazy map boundary forwards its props to JourneyMap. Keep the newer
 * verification callback typed at this host integration boundary until that
 * drop-in wrapper's public type is widened in its own maintenance change.
 */
type RouteAwareJourneyMapProps = ComponentProps<typeof JourneyMap> & {
  onRouteVerificationChange?: (change: { day: number; status: RouteVerificationStatus; evidence?: RouteEvidence }) => void;
};
const RouteAwareJourneyMap = JourneyMap as unknown as (props: RouteAwareJourneyMapProps) => ReturnType<typeof JourneyMap>;

export function agentConnectionMessage(state: AgentConnectionState): string {
  if (state === 'online') return '在线模型正在解析偏好，并会动态召回目的地；目的地细节仍需在出发前核验。';
  if (state === 'recall-unavailable') return '在线偏好解析已完成，但动态召回不可用；当前使用本地编辑库候选。';
  if (state === 'unavailable') return '在线解析不可用，当前使用本地演示偏好；候选与路线来自静态编辑库。';
  return '当前为本地演示模式；候选与路线来自静态编辑库。';
}

const tagKeywords: Record<string, RegExp> = {
  安静: /安静|不被打扰|低刺激|人少/, 独处: /独处|一个人|空白/, 清冷: /冷|风|雾|潮湿/,
  步行: /步行|散步|走路|古道|步道/, 非热门: /游客|热门|小镇|不急着被看见/,
  '夜晚有生活': /夜晚|酒吧|酒馆|夜色/, 松弛: /慢|松弛|放空|不赶/, 怀旧: /旧|电车|日常/,
  温柔: /海风|温泉|食堂/, 慢生活: /慢|日常|不赶/, 海风: /海|风|港/,
  轻社交: /酒馆|食堂|生活/, 降噪: /静音|安静|低刺激/, 自然: /山|水|竹|海|茶/,
  少商业化: /商业|游客|人流|小镇/, 留白: /空白|发呆|不安排|慢/,
};

export function deriveResultScenario(scenario: Scenario, scope: Scope): Scenario {
  if (scope === 'domestic') return 'domestic';
  return scope === 'abroad' && scenario === 'domestic' ? 'harbor' : scenario;
}

export function catalogBudgetCeiling(place: Destination): number {
  return Math.max(...(place.budget.match(/[\d,]+/g) ?? ['0']).map((value) => Number(value.replace(/,/g, ''))));
}

export function isInScope(place: Destination, scope: Scope): boolean {
  if (scope === 'any') return true;
  return scope === 'domestic' ? place.country === '中国' : place.country !== '中国';
}

export function isWithinEditorialBudget(place: Destination, budget: Budget): boolean {
  const ceiling = catalogBudgetCeiling(place);
  return budget === 'flexible' || (budget === 'medium' ? ceiling <= 4500 : ceiling <= 3000);
}

export function itineraryForQuery(place: Destination, days: TravelDays) {
  return place.itineraryVariants?.[days] ?? place.itinerary.slice(0, days);
}

export function scoreCatalogMatch(place: Destination, activeTags: string[], refinements: string[]): number {
  const searchable = `${place.tagline} ${place.atmosphere.join(' ')} ${place.reasons.join(' ')} ${place.tradeoff}`;
  const tagDelta = activeTags.reduce((total, tag) => total + (tagKeywords[tag]?.test(searchable) ? 2 : -2), 0);
  const refinementDelta = refinements.reduce((total, refinement) => {
    if (refinement === '再安静一点') return total + (tagKeywords.安静.test(searchable) ? 5 : -4);
    if (refinement === '少一点商业化') return total + (/商业|游客|人流|热门/.test(searchable) ? -4 : 3);
    if (refinement === '更容易抵达') return total + (place.role === 'easy-to-reach' ? 6 : -2);
    return total;
  }, 0);
  return Math.max(1, Math.min(99, place.matchScore + tagDelta + refinementDelta));
}

export function filterCatalogResults(scenario: Scenario, query: CatalogQuery, activeTags: string[]): Destination[] {
  return destinations[deriveResultScenario(scenario, query.scope)]
    .filter((place) => isInScope(place, query.scope))
    .filter((place) => place.tripDayOptions.includes(query.days) && itineraryForQuery(place, query.days).length === query.days)
    .filter((place) => isWithinEditorialBudget(place, query.budget))
    .map((place) => ({ ...place, matchScore: scoreCatalogMatch(place, activeTags, query.refinements) }))
    .sort((left, right) => right.matchScore - left.matchScore);
}

export type PreferenceEnhancedDestination = Destination & {
  /** A local-only, inspectable explanation for the optional preference increment. */
  preferenceReason?: string;
};

/**
 * Applies preference ranking only after `filterCatalogResults` has enforced
 * scope, duration and budget. It never adds candidates back into the result.
 */
export function rerankCatalogResults(hardFilteredResults: readonly Destination[], preferenceProfile?: PreferenceProfile): PreferenceEnhancedDestination[] {
  if (!preferenceProfile || preferenceProfile.savedDestinationCount === 0) return [...hardFilteredResults];
  return rankByPreferenceIncrement(hardFilteredResults, preferenceProfile).map(({ destination, finalScore, reasons }) => ({
    ...destination,
    matchScore: Math.min(99, finalScore),
    preferenceReason: reasons[0]?.evidence ?? '符合本次硬条件；本地偏好未产生额外加分',
    reasons: [`优先原因 · ${reasons[0]?.evidence ?? '符合本次硬条件；本地偏好未产生额外加分'}`, ...destination.reasons],
  }));
}

export function getRoutePlanningState(place: Destination, days: TravelDays, transport: TransportPreference): RoutePlanningState {
  const plannedDays = itineraryForQuery(place, days);
  return {
    dayCount: plannedDays.length,
    source: 'editorial-itinerary',
    routingStatus: 'not-connected',
    transportPreference: transport,
    plannedPoiCount: plannedDays.reduce((count, day) => count + day.pois.length, 0),
    plannedLegCount: plannedDays.reduce((count, day) => count + day.travelLegs.length, 0),
  };
}

/** Only surfaces conditions explicitly present in the user's words; it never changes form state itself. */
export function detectConditions(text: string): DetectedConditions {
  const scope = /只?看?国内|境内|国内游/.test(text) ? 'domestic' : /只?看?海外|国外|出境|境外/.test(text) ? 'abroad' : undefined;
  const days = /(?:住|玩|待|安排)?\s*4\s*(?:天|日)|四\s*(?:天|日)/.test(text) ? 4
    : /(?:住|玩|待|安排)?\s*3\s*(?:天|日)|三\s*(?:天|日)/.test(text) ? 3
      : /(?:住|玩|待|安排)?\s*2\s*(?:天|日)|两\s*(?:天|日)/.test(text) ? 2 : undefined;
  const departure = ['上海', '北京', '广州', '成都'].find((city) => new RegExp(`从?${city}(?:出发|过去|走)?`).test(text));
  const budget = /预算.{0,6}(?:低|少|紧)|省一点|便宜|低预算|预算有限/.test(text) ? 'low'
    : /预算.{0,6}(?:适中|中等)|控制预算/.test(text) ? 'medium' : undefined;
  const transport = /自驾|开车/.test(text) ? 'drive'
    : /高铁|火车|动车/.test(text) ? 'rail'
      : /飞机|航班/.test(text) ? 'flight'
        : /公交|地铁|公共交通/.test(text) ? 'public-transit' : undefined;
  return { scope, days, budget, departure, transport };
}

function readSavedPlaces(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function readLastTravelQuery(): StoredTravelQuery | undefined {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LAST_QUERY_STORAGE_KEY) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const query = value as Partial<StoredTravelQuery>;
    if (typeof query.text !== 'string' || query.text.length > 300
      || !['any', 'domestic', 'abroad'].includes(query.scope ?? '')
      || ![2, 3, 4].includes(query.days ?? 0)
      || !['flexible', 'low', 'medium'].includes(query.budget ?? '')
      || typeof query.departure !== 'string' || query.departure.length > 30
      || !['undecided', 'rail', 'flight', 'drive', 'public-transit'].includes(query.transport ?? '')) return undefined;
    return query as StoredTravelQuery;
  } catch { return undefined; }
}

function inferScenario(text: string): Scenario {
  if (/上海|国内|周末|古镇|喝茶|南山|水/.test(text)) return 'domestic';
  if (/海街|电车|夏|海风|旧房子/.test(text)) return 'summer';
  return 'harbor';
}

export default function App() {
  const [lastTravelQuery] = useState<StoredTravelQuery | undefined>(readLastTravelQuery);
  const [status, setStatus] = useState<Status>('idle');
  const [text, setText] = useState(lastTravelQuery?.text ?? '');
  const [scenario, setScenario] = useState<Scenario>('harbor');
  const [profile, setProfile] = useState<VibeProfile | null>(null);
  const [dynamicResults, setDynamicResults] = useState<Destination[] | null>(null);
  const [selected, setSelected] = useState<Destination | null>(null);
  const [scope, setScope] = useState<Scope>(lastTravelQuery?.scope ?? 'any');
  const [days, setDays] = useState<TravelDays>(lastTravelQuery?.days ?? 3);
  const [budget, setBudget] = useState<Budget>(lastTravelQuery?.budget ?? 'flexible');
  const [departure, setDeparture] = useState(lastTravelQuery?.departure ?? '暂不确定');
  const [transport, setTransport] = useState<TransportPreference>(lastTravelQuery?.transport ?? 'undecided');
  const [removedTags, setRemovedTags] = useState<string[]>([]);
  const [refinements, setRefinements] = useState<string[]>([]);
  const [queryVersion, setQueryVersion] = useState(0);
  const [queryChange, setQueryChange] = useState('尚未提交旅行委托');
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<string[]>(readSavedPlaces);
  const [error, setError] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);
  const [connectionRequired, setConnectionRequired] = useState(false);
  const [connectionSettings, setConnectionSettings] = useState<ConnectionSettings>(readConnectionSettings);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showRestoreNotice, setShowRestoreNotice] = useState(() => Boolean(lastTravelQuery?.text));
  const [adjustment, setAdjustment] = useState('');
  const [detectedConditions, setDetectedConditions] = useState<DetectedConditions>({});
  const [mediaSummary, setMediaSummary] = useState('');
  const [agentConnection, setAgentConnection] = useState<AgentConnectionState>(REAL_AGENT_ENABLED ? 'idle' : 'demo');
  const [preferenceProfile, setPreferenceProfile] = useState<PreferenceProfile>();
  // This is intentionally per-view state: route verification is neither a preference nor an analytics event.
  const [routeStatus, setRouteStatus] = useState<Partial<Record<number, RouteVerificationStatus>>>({});
  const timersRef = useRef<Set<number>>(new Set());
  const flowIdRef = useRef(0);
  const savedTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const resultScenario = deriveResultScenario(scenario, scope);
  const activeTags = useMemo(() => profile?.emotions.map((emotion) => emotion.label).filter((label) => !removedTags.includes(label)) ?? [], [profile, removedTags]);
  const query: CatalogQuery = { scope, days, budget, departure, transport, removedTags, refinements };
  const savedDestinations = useMemo(() => Object.values(destinations).flat().filter((place) => saved.includes(place.id)), [saved]);
  const hardFilteredResults = useMemo(() => filterCatalogResults(scenario, query, activeTags), [activeTags, budget, days, departure, refinements, removedTags, scenario, scope, transport]);
  const results = useMemo(() => dynamicResults ?? rerankCatalogResults(hardFilteredResults, preferenceProfile), [dynamicResults, hardFilteredResults, preferenceProfile]);
  const resultSource = dynamicResults ? 'agent' : 'editorial';
  const selectedItinerary = useMemo(() => selected ? itineraryForQuery(selected, days) : [], [selected, days]);
  const selectedForQuery = useMemo(() => selected ? { ...selected, itinerary: selectedItinerary } : null, [selected, selectedItinerary]);

  useEffect(() => { try { window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(saved)); } catch { /* persistence is optional */ } }, [saved]);
  useEffect(() => {
    try {
      if (!text.trim()) { window.localStorage.removeItem(LAST_QUERY_STORAGE_KEY); return; }
      window.localStorage.setItem(LAST_QUERY_STORAGE_KEY, JSON.stringify({ text, scope, days, budget, departure, transport } satisfies StoredTravelQuery));
    } catch { /* restoring a draft is optional when storage is blocked */ }
  }, [text, scope, days, budget, departure, transport]);
  useEffect(() => {
    if (savedDestinations.length === 0) {
      clearPreferenceProfile();
      setPreferenceProfile(undefined);
      return;
    }
    const nextProfile = derivePreferenceProfile(savedDestinations);
    savePreferenceProfile(nextProfile);
    setPreferenceProfile(nextProfile);
  }, [savedDestinations]);
  useEffect(() => () => { timersRef.current.forEach((id) => window.clearTimeout(id)); }, []);
  useEffect(() => {
    setRouteStatus({});
  }, [selected?.id, days]);
  useEffect(() => {
    if (!showSaved) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeSaved(); };
    window.addEventListener('keydown', closeOnEscape);
    window.setTimeout(() => document.getElementById('saved-dialog-close')?.focus(), 0);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showSaved]);
  useEffect(() => {
    if (!showMobileMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowMobileMenu(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showMobileMenu]);

  const cancelFlow = () => { timersRef.current.forEach((id) => window.clearTimeout(id)); timersRef.current.clear(); flowIdRef.current += 1; return flowIdRef.current; };
  const schedule = (callback: () => void, delay: number, flowId: number) => { const id = window.setTimeout(() => { timersRef.current.delete(id); if (flowId === flowIdRef.current) callback(); }, delay); timersRef.current.add(id); };
  const focusTravelBrief = () => document.querySelector<HTMLTextAreaElement>('[aria-label="描述你想要的旅行感觉"]')?.focus();
  const cancelAndReturnToEditor = () => { cancelFlow(); setStatus('idle'); setStep(0); setAdjustment(''); focusTravelBrief(); };
  const requireConnectionKey = () => {
    if (!REAL_AGENT_ENABLED || hasConnectionKey(connectionSettings)) return true;
    setConnectionRequired(true);
    setShowConnectionSettings(true);
    return false;
  };
  const currentScrollBehavior = () => scrollBehaviorFor(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const intentContext = () => `范围：${scope === 'domestic' ? '只看国内' : scope === 'abroad' ? '只看海外' : '国内外皆可'}；天数：${days} 天；预算：${budget === 'low' ? '尽量低' : budget === 'medium' ? '适中' : '灵活'}；出发地：${departure}；交通偏好：${transportLabels[transport]}。${mediaSummary ? `\n本地多模态灵感（仅用户确认的文字摘要，不含文件）：${mediaSummary}` : ''}`;
  const recordQueryChange = (change: string) => { setQueryVersion((version) => version + 1); setQueryChange(change); setSelected(null); setDynamicResults(null); };
  const changeScope = (nextScope: Scope) => { setScope(nextScope); recordQueryChange(`范围改为「${nextScope === 'domestic' ? '只看国内' : nextScope === 'abroad' ? '只看海外' : '国内外皆可'}」`); };
  const changeDays = (nextDays: TravelDays) => { setDays(nextDays); recordQueryChange(`行程长度改为 ${nextDays === 4 ? '4 天以上' : `${nextDays} 天`}`); };
  const changeBudget = (nextBudget: Budget) => { setBudget(nextBudget); recordQueryChange(`预算改为「${nextBudget === 'low' ? '尽量低' : nextBudget === 'medium' ? '适中' : '灵活'}」`); };
  const changeDeparture = (nextDeparture: string) => { setDeparture(nextDeparture); recordQueryChange(`出发地改为「${nextDeparture}」；尚未进行实时可达性核验`); };
  const changeTransport = (nextTransport: TransportPreference) => { setTransport(nextTransport); recordQueryChange(`交通偏好改为「${transportLabels[nextTransport]}」；尚未用于道路导航`); };
  const closeSaved = () => { setShowSaved(false); window.setTimeout(() => savedTriggerRef.current?.focus(), 0); };
  const clearLocalPreference = () => { clearPreferenceProfile(); setPreferenceProfile(undefined); setAdjustment('已清除本地偏好记忆；收藏仍会保留'); };
  const analyzeImageWithConsent = async (file: File, description: string) => {
    if (!requireConnectionKey()) throw new MediaInsightError('service_unavailable');
    try {
      return await analyzeAuthorizedImage(file, description, { connection: connectionSettings });
    } catch (error) {
      // The component intentionally keeps a generic failure message. This toast
      // supplies the actionable local size limit without exposing media details.
      if (error instanceof MediaInsightError && error.code === 'image_too_large') setAdjustment(error.message);
      throw error;
    }
  };
  const analyzeImageUrlWithConsent = async (url: string, description: string) => {
    if (!requireConnectionKey()) throw new MediaInsightError('service_unavailable');
    try {
      return await analyzeAuthorizedImageUrl(url, description, globalThis.fetch, connectionSettings);
    } catch (error) {
      if (error instanceof MediaInsightError) setAdjustment(error.message);
      throw error;
    }
  };
  const handleRouteVerificationChange = ({ day, status: nextStatus, evidence }: { day: number; status: RouteVerificationStatus; evidence?: RouteEvidence }) => {
    // Ignore late callbacks for a day no longer present in the selected query itinerary.
    if (!selectedItinerary.some((itineraryDay) => itineraryDay.day === day)) return;
    if (nextStatus === 'verified' && evidence && selected?.id) saveRouteEvidence(selected.id, day, evidence);
    setRouteStatus((current) => current[day] === nextStatus ? current : { ...current, [day]: nextStatus });
  };

  const run = (nextText = text, nextScenario = inferScenario(nextText), refining = false) => {
    if (!requireConnectionKey()) return;
    const flowId = cancelFlow();
    if (nextText.trim().length < 8) { setError('再多说一点点。比如：天气、同行的人，或者你想避开什么。'); setStatus('error'); return; }
    const scopedScenario = scope === 'domestic' ? 'domestic' : scope === 'abroad' && nextScenario === 'domestic' ? 'harbor' : nextScenario;
    track('brief_submitted', { source: mediaSummary ? 'text_and_local_media' : 'text', refining });
    setError(''); setText(nextText); setScenario(scopedScenario); setProfile(null); setSelected(null); setDynamicResults(null); setRemovedTags([]); setRefinements([]); setDetectedConditions(detectConditions(nextText)); setStep(0); setAgentConnection(REAL_AGENT_ENABLED ? 'idle' : 'demo'); setStatus(refining ? 'refining' : 'interpreting'); recordQueryChange(refining ? '已根据新的描述重新生成查询' : '已提交旅行委托，等待确认后由 Agent 动态召回目的地');
    schedule(() => {
      if (!REAL_AGENT_ENABLED) { setProfile(vibes[scopedScenario]); setAgentConnection('demo'); setStatus('reviewing-vibe'); return; }
      void interpretWithTokenHub(`${nextText}\n${intentContext()}`, connectionSettings).then((remoteProfile) => {
        if (flowId !== flowIdRef.current) return;
        setProfile({ ...remoteProfile, constraints: [...new Set([...remoteProfile.constraints, `${days} 天`, scope === 'domestic' ? '国内' : scope === 'abroad' ? '海外' : '国内外皆可'])] }); setAgentConnection('online'); setStatus('reviewing-vibe');
      }).catch(() => {
        if (flowId !== flowIdRef.current) return;
        setProfile(vibes[scopedScenario]); setAgentConnection('unavailable'); setStatus('reviewing-vibe'); setAdjustment('TokenHub 暂时不可用，已切换到本地演示数据');
      });
    }, refining ? 650 : 900, flowId);
  };

  const applyDetectedConditions = () => {
    const changes: string[] = [];
    if (detectedConditions.scope) { setScope(detectedConditions.scope); changes.push(detectedConditions.scope === 'domestic' ? '国内' : '海外'); }
    if (detectedConditions.days) { setDays(detectedConditions.days); changes.push(`${detectedConditions.days} 天`); }
    if (detectedConditions.departure) { setDeparture(detectedConditions.departure); changes.push(`从${detectedConditions.departure}出发`); }
    if (detectedConditions.budget) { setBudget(detectedConditions.budget); changes.push(detectedConditions.budget === 'low' ? '尽量低预算' : '适中预算'); }
    if (detectedConditions.transport) { setTransport(detectedConditions.transport); changes.push(`交通：${transportLabels[detectedConditions.transport]}`); }
    if (changes.length) { track('constraints_applied', { count: changes.length }); recordQueryChange(`已应用文本中检测到的条件：${changes.join('、')}`); }
  };

  const recallDynamicResults = async (flowId: number, constraints: Pick<CatalogQuery, 'scope' | 'days' | 'budget' | 'departure' | 'transport'>) => {
    // A failed intent parse already tells us the upstream is unavailable. Do
    // not make the person wait through a second timeout before the local
    // editorial fallback can appear.
    if (!REAL_AGENT_ENABLED || agentConnection !== 'online' || !profile || !requireConnectionKey()) return null;
    try {
      const candidates = await recallDestinationsWithTokenHub({ input: text, profile, constraints: { ...constraints, transport: transportLabels[constraints.transport] } }, connectionSettings);
      if (flowId !== flowIdRef.current) return null;
      const places = candidates.map(destinationFromAgent);
      setDynamicResults(places);
      setAgentConnection('online');
      return places;
    } catch {
      if (flowId === flowIdRef.current) {
        setDynamicResults(null);
        setAgentConnection('recall-unavailable');
        setAdjustment('动态召回暂时不可用，已切换到本地编辑库候选');
      }
      return null;
    }
  };
  const explore = () => {
    const flowId = cancelFlow();
    setStatus('exploring'); setStep(0); setDynamicResults(null);
    steps.forEach((_, index) => schedule(() => setStep(index), 520 * index, flowId));
    void recallDynamicResults(flowId, { scope, days, budget, departure, transport }).then((places) => {
      if (flowId !== flowIdRef.current) return;
      const count = places?.length ?? filterCatalogResults(scenario, query, activeTags).length;
      track('candidates_viewed', { count });
      setStatus('showing-results');
    });
  };
  const refine = (label: string) => {
    if (!requireConnectionKey()) return;
    const nextScope: Scope = label === '只看国内' ? 'domestic' : scope;
    const nextBudget: Budget = label === '预算降低' ? 'low' : budget;
    const nextScenario = deriveResultScenario(scenario, nextScope);
    const flowId = cancelFlow();
    const isDataBackedRefinement = ['再安静一点', '少一点商业化', '更容易抵达'].includes(label);
    setScope(nextScope); setBudget(nextBudget); setScenario(nextScenario); setRefinements((items) => isDataBackedRefinement && !items.includes(label) ? [...items, label] : items); setAdjustment(label); recordQueryChange(REAL_AGENT_ENABLED ? `加入偏好「${label}」并重新请求 Agent 召回` : `加入偏好「${label}」并重算编辑库匹配`); setStatus('refining'); setStep(0);
    schedule(() => setStep(2), 650, flowId);
    void recallDynamicResults(flowId, { scope: nextScope, days, budget: nextBudget, departure, transport }).then(() => {
      if (flowId === flowIdRef.current) setStatus('showing-results');
    });
  };
  const toggleSave = (id: string) => setSaved((items) => {
    const isSaved = items.includes(id);
    track('destination_selected', { destinationId: id, action: isSaved ? 'unsaved' : 'saved' });
    return isSaved ? items.filter((item) => item !== id) : [...items, id];
  });
  const removeTag = (label: string) => { setRemovedTags((items) => items.includes(label) ? items : [...items, label]); recordQueryChange(`移除「${label}」标签；该偏好已不参与编辑库匹配`); };
  const choosePlace = (place: Destination) => {
    track('destination_selected', { destinationId: place.id });
    setSelected(place); setStatus('showing-detail');
    window.setTimeout(() => document.getElementById('trip-plan')?.scrollIntoView({ behavior: currentScrollBehavior(), block: 'start' }), 0);
  };
  const trackNavigation = (destinationId: string, target: 'catalog-map' | 'route-leg') => track('navigation_opened', { destinationId, target });
  const copySummary = async () => { if (!selected) return; const summary = `去处 Somewhere｜${selected.city}\n${selected.tagline}\n${itineraryForQuery(selected, days).map((day) => `Day ${day.day} ${day.theme}`).join(' · ')}`; try { await navigator.clipboard.writeText(summary); track('itinerary_shared', { destinationId: selected.id }); setAdjustment('已复制一份轻旅行提案'); } catch { setAdjustment('当前环境无法直接复制，请手动选择摘要'); } schedule(() => setAdjustment(''), 2000, flowIdRef.current); };

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => { cancelFlow(); setStatus('idle'); setSelected(null); }} aria-label="回到首页"><span className="brand-mark">去</span><span><strong>去处</strong><small>SOMEWHERE</small></span></button><div className="nav-actions"><button ref={savedTriggerRef} className="text-button" onClick={() => setShowSaved(true)}><Bookmark size={15} /> 我的收藏 {saved.length > 0 && <em>{saved.length}</em>}</button><button className="text-button hide-mobile" onClick={() => document.getElementById('principle')?.scrollIntoView({ behavior: currentScrollBehavior() })}>原理</button><button className="text-button connection-button" onClick={() => setShowConnectionSettings(true)}><Settings2 size={15} /> 设置</button><button className="outline-button" onClick={() => { cancelFlow(); setStatus('idle'); setText(''); setProfile(null); setSelected(null); }}>换一种感觉 <ArrowRight size={15} /></button></div><button ref={mobileMenuTriggerRef} className="menu-button" aria-label={showMobileMenu ? '关闭菜单' : '打开菜单'} aria-expanded={showMobileMenu} aria-controls="mobile-site-menu" onClick={() => setShowMobileMenu((open) => !open)}><Menu size={20} /></button>{showMobileMenu && <nav id="mobile-site-menu" className="mobile-site-menu" aria-label="移动端导航"><button onClick={() => { setShowMobileMenu(false); setShowSaved(true); }}><Bookmark size={15} /> 我的收藏 {saved.length > 0 && <em>{saved.length}</em>}</button><button onClick={() => { setShowMobileMenu(false); document.getElementById('principle')?.scrollIntoView({ behavior: currentScrollBehavior() }); }}>原理</button><button onClick={() => { setShowMobileMenu(false); setShowConnectionSettings(true); }}><Settings2 size={15} /> 设置</button><button onClick={() => { setShowMobileMenu(false); cancelFlow(); setStatus('idle'); setText(''); setProfile(null); setSelected(null); }}>换一种感觉 <ArrowRight size={15} /></button></nav>}</header>
    {agentConnection !== 'idle' && <section className="section-wrap" aria-live={agentConnection === 'unavailable' || agentConnection === 'recall-unavailable' ? 'assertive' : 'polite'}>
      <div className="privacy" role={agentConnection === 'unavailable' || agentConnection === 'recall-unavailable' ? 'alert' : 'status'}>
        <span className="dot" /> {agentConnectionMessage(agentConnection)}
        {(agentConnection === 'unavailable' || agentConnection === 'recall-unavailable') && <button className="edit-link" onClick={() => run(text, inferScenario(text))}>重新连接并解析 <ArrowRight size={14} /></button>}
      </div>
    </section>}
    <main>
      {!['showing-results', 'showing-detail'].includes(status) && <><section className="hero section-wrap"><div className="eyebrow"><span className="eyebrow-line" /> PRIVATE TRAVEL EDITOR · 001</div><h1>把一种感觉，<br /><i>翻译成一个地方。</i></h1><p className="hero-sub">不必先知道去哪里。告诉我，你想进入怎样的天气、节奏和生活。</p>{showRestoreNotice && <div className="restore-note" role="status">已恢复此设备上的最近一次旅行委托与条件；尚未重新调用 AI。<button type="button" onClick={() => setShowRestoreNotice(false)} aria-label="关闭恢复提示"><X size={14} /></button></div>}<div className="brief-card"><div className="brief-label"><span>旅行委托</span><span className="mono">{text.length} / 300</span></div><textarea aria-label="描述你想要的旅行感觉" value={text} onChange={(event) => { setText(event.target.value.slice(0, 300)); if (status === 'error') setStatus('idle'); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') run(); }} placeholder="我想一个人待三天。天气有点冷，可以一直走路……" /><div className="preference-panel"><div className="preference-title"><SlidersHorizontal size={14} /> 这次的现实条件</div><div className="scope-tabs" role="group" aria-label="目的地范围">{([{ value: 'any', label: '国内外' }, { value: 'domestic', label: '只看国内' }, { value: 'abroad', label: '只看海外' }] as const).map((item) => <button key={item.value} className={scope === item.value ? 'active' : ''} aria-pressed={scope === item.value} onClick={() => changeScope(item.value)}>{item.value === 'abroad' && <Globe2 size={13} />}{item.label}</button>)}</div><label>天数<select value={days} onChange={(event) => changeDays(Number(event.target.value) as TravelDays)}><option value={2}>2 天</option><option value={3}>3 天</option><option value={4}>4 天+</option></select></label><label>预算<select value={budget} onChange={(event) => changeBudget(event.target.value as Budget)}><option value="flexible">灵活</option><option value="medium">适中</option><option value="low">尽量低</option></select></label><label>出发地<select aria-label="出发地" value={departure} onChange={(event) => changeDeparture(event.target.value)}><option>暂不确定</option><option>上海</option><option>北京</option><option>广州</option><option>成都</option><option>其他城市</option></select></label><label>交通<select aria-label="交通偏好" value={transport} onChange={(event) => changeTransport(event.target.value as TransportPreference)}><option value="undecided">暂不确定</option><option value="rail">高铁 / 火车</option><option value="flight">飞机</option><option value="drive">自驾</option><option value="public-transit">公共交通</option></select></label></div><div className="brief-footer"><button className="upload-button" onClick={() => { document.getElementById('multimodal-brief')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); document.getElementById('somewhere-image-inspiration-upload')?.click(); }}><Upload size={15} /> 加入一张图片</button><button className="primary-button" onClick={() => run()}><span>替我寻找</span><Send size={16} /></button></div></div>{error && <div className="error-note" role="alert"><Info size={16} /> {error}<button onClick={() => setStatus('idle')}><X size={14} /></button></div>}<div className="inspiration-row"><span>灵感：</span>{inspirations.map((item) => <button key={item.label} onClick={() => { setText(item.text); setScenario(item.scenario); }}>{item.label}</button>)}</div><div className="privacy"><span className="dot" /> {REAL_AGENT_ENABLED ? 'TokenHub 先解析感觉，再由 Agent 动态召回目的地' : '本地演示模式 · 候选来自静态编辑库'}</div></section>
      <div className="section-wrap"><MultimodalBrief onChange={setMediaSummary} onAnalyzeImage={analyzeImageWithConsent} onAnalyzeImageUrl={analyzeImageUrlWithConsent} /></div></>}
      {status === 'interpreting' && <section className="translation section-wrap reveal" aria-live="polite"><div className="section-kicker">01 / VIBE TRANSLATION <span>正在理解你的委托</span></div><div className="profile-block"><div className="profile-summary">正在解析你的旅行感觉与现实条件。这通常只需要几秒，请不要重复点击。</div><span className="status-pill"><span className="pulse-dot" /> 正在连接 {REAL_AGENT_ENABLED ? 'TokenHub' : '本地演示解析器'}</span><button className="flow-cancel-button outline-button" onClick={cancelAndReturnToEditor}><X size={15} /> 取消并返回编辑</button></div></section>}
      {(status === 'reviewing-vibe' || status === 'exploring' || status === 'refining') && profile && <section className="translation section-wrap reveal"><div className="section-kicker">01 / VIBE TRANSLATION <span>AI 对你的理解</span></div><div className="translation-grid"><div className="quote-block"><div className="mini-label">你的原始委托</div><blockquote>“{text}”</blockquote><button className="edit-link" onClick={() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus()}>修改原始描述 <ArrowRight size={14} /></button></div><div className="profile-block"><div className="profile-summary">{profile.summary}</div><div className="tag-list">{profile.emotions.filter((emotion) => !removedTags.includes(emotion.label)).map((emotion) => <button className="vibe-tag" key={emotion.label} onClick={() => removeTag(emotion.label)}><span>{emotion.label}</span><b>{emotion.score}%</b><X size={12} /></button>)}</div><div className="constraint-list">{profile.environments.map((item) => <span key={item}>#{item}</span>)} {profile.constraints.map((item) => <span key={item} className="constraint">{item}</span>)} <span className="constraint">出发地：{departure}</span><span className="constraint">交通：{transportLabels[transport]}</span></div>{(detectedConditions.scope || detectedConditions.days || detectedConditions.departure) && <div className="constraint-list" aria-label="从文本检测到的条件"><span className="mini-label">文本检测到（尚未覆盖手动条件）</span>{detectedConditions.scope && <span className="constraint">{detectedConditions.scope === 'domestic' ? '国内' : '海外'}</span>}{detectedConditions.days && <span className="constraint">{detectedConditions.days} 天</span>}{detectedConditions.departure && <span className="constraint">从 {detectedConditions.departure} 出发</span>}<button className="outline-button" onClick={applyDetectedConditions}>应用到本次条件</button></div>}</div></div><div className="translation-footer"><span>查询 v{queryVersion} · {queryChange}</span>{status === 'reviewing-vibe' ? <button className="dark-button" onClick={explore}>确认理解，开始生成候选 <ArrowRight size={16} /></button> : <span className="status-pill"><span className="pulse-dot" /> {status === 'refining' ? `正在根据「${adjustment}」重新寻找` : '正在探索世界'}</span>}</div></section>}
      {(status === 'exploring' || status === 'refining') && <div className="section-wrap flow-cancel-wrap"><button className="flow-cancel-button outline-button" onClick={cancelAndReturnToEditor}><X size={15} /> 取消并返回编辑</button><span>会保留你已写下的旅行委托与条件。</span></div>}
      {(status === 'exploring' || status === 'refining') && <section className="exploration section-wrap reveal"><div className="map-panel"><div className="map-grid" /><div className="map-label top">N 45°</div><div className="map-label side">E 120°</div><div className="route route-one" /><div className="route route-two" /><div className="coord c1"><span />01</div><div className="coord c2"><span />02</div><div className="coord c3"><span />03</div><div className="map-caption"><Compass size={15} /> {adjustment ? `重组候选：${adjustment}` : 'SCANNING THE QUIETER SIDE OF THE WORLD'}</div></div><div className="progress-panel"><div className="section-kicker">02 / WORLD EXPLORER</div><h2>让我们沿着这枚感觉，<br />在世界上找一找。</h2><ol>{steps.map((item, index) => <li key={item} className={index <= step ? 'active' : ''}><span>{index < step ? <Check size={13} /> : `0${index + 1}`}</span>{item}{index === step && <i />}</li>)}</ol></div></section>}
      {status === 'showing-results' && <section className="results section-wrap reveal"><div className="results-head"><div><div className="section-kicker">03 / {resultSource === 'agent' ? 'AGENT DESTINATION RECALL' : 'EDITORIAL CATALOG MATCH'}</div><h2>{results.length > 0 ? <>这 3 个地方，<br /><i>各自回应你的一部分。</i></> : <>这组条件下，<br /><i>还没有合适的候选。</i></>}</h2></div><div className="result-note"><span className="pulse-dot" /> {scope === 'domestic' ? '只看国内' : scope === 'abroad' ? '只看海外' : '国内外'} · {days} 天</div></div>{results.length > 0 ? <div className="destination-grid">{results.map((place, index) => <DestinationCard key={place.id} place={place} index={index} days={days} source={resultSource} saved={saved.includes(place.id)} onSave={() => toggleSave(place.id)} onSelect={() => choosePlace(place)} onNavigate={() => trackNavigation(place.id, 'catalog-map')} />)}</div> : <div className="empty-state" role="status"><Info size={24} /><p>这组条件暂时没有合适的候选。换一种感觉或放宽一个条件再试试。</p></div>}<div className="refine-row"><span>想换一个方向：</span>{['再安静一点', '更温暖一些', '少一点商业化', '更容易抵达', '预算降低', '只看国内'].map((label) => <button key={label} onClick={() => refine(label)}>{label} <ArrowRight size={13} /></button>)}</div></section>}
      {selectedForQuery && status === 'showing-detail' && <><div className="section-wrap" style={{ paddingTop: 38 }}><button className="edit-link" onClick={() => { setSelected(null); setStatus('showing-results'); window.scrollTo({ top: 0, behavior: currentScrollBehavior() }); }}><ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} /> 返回三个候选</button></div><Detail place={selectedForQuery} days={days} transport={transport} routeStatus={routeStatus} saved={saved.includes(selectedForQuery.id)} onSave={() => toggleSave(selectedForQuery.id)} onCopy={copySummary} onNavigate={() => trackNavigation(selectedForQuery.id, 'route-leg')} /></>}
      {!['showing-results', 'showing-detail'].includes(status) && <section id="principle" className="principle section-wrap"><div className="principle-mark">“</div><div><div className="section-kicker">WHY SOMEWHERE</div><h2>不是替你安排景点，<br /><i>是先理解你想成为谁。</i></h2><p>去处把模糊的情绪翻译成可探索的偏好，再用现实约束筛掉不合适的答案。每个推荐都保留一点取舍，也保留一点未知。</p></div></section>}
    </main>
    <footer><span>去处 SOMEWHERE · A TRAVEL AGENT FOR FEELINGS</span><span>AI 生成的氛围提案，不构成旅行安全或预订建议。</span></footer>
    {showSaved && <div className="modal-backdrop" onClick={closeSaved}><div className="saved-modal" role="dialog" aria-modal="true" aria-labelledby="saved-dialog-title" onClick={(event) => event.stopPropagation()}><button id="saved-dialog-close" className="close-button" aria-label="关闭收藏弹层" onClick={closeSaved}><X size={18} /></button><div className="section-kicker">YOUR SAVED PLACES</div><h2 id="saved-dialog-title">收藏的去处</h2>{saved.length === 0 ? <div className="empty-state"><Heart size={24} /><p>还没有收藏。<br />遇见一个让你心动的地方吧。</p></div> : <div className="saved-list">{Object.values(destinations).flat().filter((place) => saved.includes(place.id)).map((place) => <button key={place.id} onClick={() => { choosePlace(place); closeSaved(); }}><span>{place.city}</span><small>{place.country} · {place.tagline}</small><ArrowRight size={15} /></button>)}</div>}</div></div>}
    {showConnectionSettings && <ConnectionSettingsDialog value={connectionSettings} required={connectionRequired} onClose={() => { setShowConnectionSettings(false); setConnectionRequired(false); }} onSave={(next) => { const safe = saveConnectionSettings(next); setConnectionSettings(safe); setShowConnectionSettings(false); setConnectionRequired(false); setAdjustment(hasConnectionKey(safe) ? '模型连接设置已保存，将在下一次请求生效' : '未配置 TokenHub Key，AI 功能暂不可用'); }} />}
    {adjustment && status !== 'refining' && <div className="toast"><Check size={15} /> {adjustment}</div>}
  </div>;
}

function DestinationCard({ place, index, days, source, saved, onSave, onSelect, onNavigate }: { place: Destination; index: number; days: TravelDays; source: 'agent' | 'editorial'; saved: boolean; onSave: () => void; onSelect: () => void; onNavigate: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const point = geometryFor(place).center;
  return <article className={`destination-card card-${index + 1}`}><button className="card-image" onClick={onSelect} aria-label={`查看${place.city}详情`}>{imageFailed ? <div className="image-fallback" role="img" aria-label={`${place.city}图片暂时不可用`}><Compass size={24} /><span>图片暂时不可用</span></div> : <img src={place.image} alt={`${place.city}的氛围`} onError={() => setImageFailed(true)} />}<div className="image-overlay" /><span className="card-index">0{index + 1} / {place.roleLabel}</span><span className="pin"><MapPin size={15} /></span></button><div className="card-content"><div className="place-heading"><div><h3>{place.city}<small>{place.region} · {place.country}</small></h3></div><button className={`save-icon ${saved ? 'saved' : ''}`} onClick={onSave} aria-label={saved ? '取消收藏' : '收藏'}>{saved ? <Bookmark size={17} fill="currentColor" /> : <Bookmark size={17} />}</button></div><p className="tagline">{place.tagline}</p><div className="match-line"><span>{source === 'agent' ? 'Agent 动态匹配' : '编辑库匹配'}</span><strong>{place.matchScore}%</strong><div className="match-bar"><i style={{ width: `${place.matchScore}%` }} /></div></div><ul className="reason-list">{place.reasons.map((reason) => <li key={reason}><Check size={13} /> {reason}</li>)}</ul><div className="tradeoff"><span>取舍</span>{place.tradeoff}</div><div className="card-actions"><button className="detail-link" onClick={onSelect}>查看 {days === 4 ? '4 天提案' : `${days} 日提案`} <ArrowRight size={15} /></button></div></div></article>;
}

function Detail({ place, days, transport, routeStatus, saved, onSave, onCopy, onNavigate }: { place: Destination; days: TravelDays; transport: TransportPreference; routeStatus: Partial<Record<number, RouteVerificationStatus>>; saved: boolean; onSave: () => void; onCopy: () => void; onNavigate: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const routePlan = getRoutePlanningState(place, days, transport);
  const itinerary = itineraryForQuery(place, days);
  const isAgentDraft = itinerary.some((day) => day.dataStatus === 'agent-generated-unverified');
  useEffect(() => setImageFailed(false), [place.image]);
  return <section id="trip-plan" className="detail section-wrap reveal"><div className="detail-cover">{imageFailed ? <div className="image-fallback" role="img" aria-label={`${place.city}图片暂时不可用`}><Compass size={28} /><span>图片暂时不可用</span></div> : <img src={place.image} alt="" onError={() => setImageFailed(true)} />}<div className="image-overlay" /><div className="detail-cover-copy"><div className="section-kicker">YOUR NEXT {routePlan.dayCount} DAYS</div><h2>如果你在{place.city}<br /><i>待上 {routePlan.dayCount} 天……</i></h2><p>{place.tagline}</p></div></div><div className="detail-body"><div className="detail-intro"><div className="section-kicker">WHY HERE / {place.city.toUpperCase()}</div><h3>这里的好，不需要一次看完。</h3><p>{place.reasons.join('。')}。</p>{isAgentDraft && <p className="route-source">这是一份 Agent 生成的体验草案，适合用来感受节奏，而不是代替订票或攻略。</p>}<div className="detail-actions"><button className="dark-button" onClick={onSave}>{saved ? <Bookmark size={16} fill="currentColor" /> : <Bookmark size={16} />} {saved ? '已收藏' : '收藏提案'}</button><button className="outline-button" onClick={onCopy}><Share2 size={15} /> 分享摘要</button></div></div><div className="day-plans"><div className="mini-label">{isAgentDraft ? 'A GENTLE EXPERIENCE OUTLINE' : 'A LOW-PRESSURE ITINERARY'}</div>{itinerary.map((day) => <div className="day-plan" key={day.day}><div className="day-number">0{day.day}</div><div><h4>{day.theme}</h4><p>{day.intro}</p><ol className="route-stops" aria-label={`第 ${day.day} 天的体验`}>{day.pois.map((poi, index) => <li key={poi.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{poi.name}</strong><p>{poi.whyItFits}</p></div></li>)}</ol></div></div>)}</div></div><div className="reality-strip"><Info size={16} /><div><strong>给自己留白</strong><p>这只是一个低压力的体验节奏。哪天想多睡一会、在咖啡馆坐久一点，都不需要补回来。</p></div><div className="alternative"><span>相似但不同</span><b>{place.alternative}</b></div></div></section>;
}
function DetailWithQuery(props: Parameters<typeof Detail>[0] & { departure: string }) {
  const { departure, ...detailProps } = props;
  return <><ArrivalRouteCheck destination={props.place} departure={departure} transport={props.transport} /><Detail {...detailProps} /></>;
}
