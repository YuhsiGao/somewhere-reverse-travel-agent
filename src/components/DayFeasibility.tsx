import type { DayPlan } from '../types';
import { evaluateDayFeasibility, formatPlanningDuration } from '../services/itinerary-feasibility';

export default function DayFeasibility({ day }: { day: DayPlan }) {
  const report = evaluateDayFeasibility(day);
  const remaining = report.remainingMinutes >= 0 ? `余 ${formatPlanningDuration(report.remainingMinutes)}` : `超出 ${formatPlanningDuration(report.remainingMinutes)}`;
  return <aside className={`day-feasibility day-feasibility--${report.level}`} aria-label={`第 ${day.day} 天参考时间预算`}>
    <div><span>TIME BUDGET · 参考</span><strong>{report.label}</strong></div>
    <p>停留 {formatPlanningDuration(report.poiMinutes)} · 移动 {formatPlanningDuration(report.travelMinutes)} · 弹性 {formatPlanningDuration(report.bufferMinutes)} <b>≈ {formatPlanningDuration(report.plannedMinutes)} / 8 小时</b> · {remaining}</p>
    <small>按编辑行程计算；不含往返、排队、营业时间和实时交通，路线核验后请重新判断。</small>
  </aside>;
}
