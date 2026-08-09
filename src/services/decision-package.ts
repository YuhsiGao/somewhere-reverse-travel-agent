import type { DayPlan, Destination, TravelMode } from '../types';
import type { RouteVerificationStatus } from '../components/DepartureChecklist';
import { isWeatherEvidenceFresh, type WeatherEvidence } from './weather';
import { isRouteEvidenceFresh, type RouteEvidence } from './route-evidence';
import { isArrivalEvidenceFresh, type ArrivalEvidence } from './arrival-evidence';

export type DecisionPackageInput = {
  destination: Destination;
  itinerary: DayPlan[];
  routeStatus?: Partial<Record<number, RouteVerificationStatus>>;
  routeEvidence?: Partial<Record<number, RouteEvidence>>;
  arrivalEvidence?: ArrivalEvidence;
  weatherEvidence?: WeatherEvidence;
  createdAt?: Date;
};

const modeLabel: Record<TravelMode, string> = {
  walk: '步行', bike: '骑行', 'public-transit': '公共交通（静态示例）', drive: '自驾', taxi: '打车',
};

const routeLabel: Record<RouteVerificationStatus, string> = {
  'not-requested': '未核验：请在页面地图中主动核验或使用可靠导航服务。',
  verified: '本次页面已生成道路路线：出发前仍需重新确认路况、施工和交通管制。',
  unavailable: '路线服务不可用：请在出发前使用可靠导航服务补充核验。',
  failed: '路线未生成可用结果：请调整方式或使用可靠导航服务核验。',
};

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

/**
 * Creates a portable decision artifact from the editorial itinerary and the
 * user's in-page verification state. It deliberately excludes raw prompts,
 * media, bookings, pricing and claims that static facts are live.
 */
export function buildDecisionPackageMarkdown({ destination, itinerary, routeStatus = {}, routeEvidence = {}, arrivalEvidence, weatherEvidence, createdAt = new Date() }: DecisionPackageInput) {
  const lines = [
    `# 去处 Somewhere｜${destination.city} 出发决策包`,
    '',
    `生成日期：${isoDate(createdAt)}`,
    `行程范围：${itinerary.length} 天 · ${destination.country} ${destination.region}`,
    `编辑预算参考：${destination.budget}`,
    '',
    '## 这份方案的边界',
    '',
    '- 目的地与 POI 是静态编辑示例，不代表营业、预约、票务、价格、签证或安全状态。',
    '- 路线状态仅记录此页面的按需核验结果；公共交通、班次与票务未接入实时规划。',
    isWeatherEvidenceFresh(weatherEvidence, createdAt)
      ? `- 已按需查询天气：${weatherEvidence.forecast.date} · ${Math.round(weatherEvidence.forecast.minC)}–${Math.round(weatherEvidence.forecast.maxC)}°C · 降水概率最高 ${Math.round(weatherEvidence.forecast.precipitationProbabilityMax)}% · 最大风速 ${Math.round(weatherEvidence.forecast.windSpeedMax)} km/h（查询于 ${weatherEvidence.checkedAt}，来源 Open-Meteo）。临近出发仍需重新查询且不替代气象预警。`
      : weatherEvidence
        ? '- 已查询的天气证据已超过 15 分钟有效窗口，未写入本决策包为“已核验”；请重新查询，它不替代气象预警。'
        : '- 天气预报尚未写入本决策包；请在临近出发时于页面中按日期查询，它不替代气象预警。',
    '',
    '## 每日方案与地图入口',
    '',
  ];
  itinerary.forEach((day) => {
    const status = routeStatus[day.day] ?? 'not-requested';
    const evidence = routeEvidence[day.day];
    lines.push(`### 第 ${day.day} 天｜${day.theme}`, '', day.intro, '');
    day.pois.forEach((poi, index) => {
      lines.push(`${index + 1}. ${poi.name}（${poi.category}，建议停留 ${poi.stayMinutes} 分钟）`, `   - 适配原因：${poi.whyItFits}`, `   - 地图/编辑来源：${poi.source.url}`, `   - 需确认：${poi.operatingRisk}`);
    });
    if (day.travelLegs.length) {
      lines.push('', '路线衔接：');
      day.travelLegs.forEach((leg) => lines.push(`- ${modeLabel[leg.mode]} · ${leg.distanceKm} km · 约 ${leg.durationMinutes} 分钟 · ${leg.navigationUrl}`, `  - ${leg.note}`));
    }
    lines.push('', `道路路线状态：${routeLabel[status]}`);
    if (isRouteEvidenceFresh(evidence, createdAt)) lines.push(`道路核验证据：${evidence.distanceKm} km · 约 ${evidence.durationMinutes} 分钟 · ${evidence.legCount} 段 · 查询于 ${evidence.checkedAt} · 来源 OSRM 道路网络（演示）。`);
    else if (evidence) lines.push('道路核验证据已超过 15 分钟有效窗口，未作为当前已核验事实导出；请重新查询。');
    lines.push('');
  });
  lines.push('## 抵达段证据', '');
  if (isArrivalEvidenceFresh(arrivalEvidence, createdAt)) lines.push(`已按需核验自驾抵达：${arrivalEvidence.departure} → ${destination.city} · ${arrivalEvidence.distanceKm} km · 约 ${arrivalEvidence.durationMinutes} 分钟 · 查询于 ${arrivalEvidence.checkedAt} · 来源 OSRM 道路网络（演示）。临近出发仍需重新确认路况、施工和交通管制。`);
  else if (arrivalEvidence) lines.push('抵达段道路证据已超过 15 分钟有效窗口，未作为当前已核验事实导出；请重新查询。');
  else lines.push('尚未写入抵达段道路证据。高铁、飞机、公共交通的班次、票务与换乘仍需使用可靠服务单独核验。');
  lines.push('');
  lines.push('## 出发前行动清单', '', '- 逐日确认天气、环境预警与衣物/备选方案。', '- 逐个确认 POI 的营业、预约、票务和临时关闭信息。', '- 确认抵达、住宿入住、最后一段接驳和返程余量。', '- 重新核验道路路线；若依赖公共交通，请使用当地可靠服务单独规划。', '', '---', '本决策包由去处 Somewhere 在当前浏览器中生成，不包含用户原始委托、上传媒体或任何预订信息。');
  return lines.join('\n');
}

export function decisionPackageFilename(destination: Pick<Destination, 'city'>, createdAt = new Date()) {
  return `somewhere-${destination.city}-${isoDate(createdAt)}-decision-package.md`;
}
