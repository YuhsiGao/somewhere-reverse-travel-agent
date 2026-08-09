import type { DayPlan } from '../types';

export type DayFeasibility = {
  day: number;
  poiMinutes: number;
  travelMinutes: number;
  bufferMinutes: number;
  plannedMinutes: number;
  availableMinutes: number;
  remainingMinutes: number;
  level: 'light' | 'balanced' | 'tight' | 'overloaded';
  label: string;
};

export const DEFAULT_ACTIVE_DAY_MINUTES = 8 * 60;

/**
 * A transparent planning heuristic, not a claim about opening hours or live
 * travel time. It makes the assumptions visible so a user can edit the plan.
 */
export function evaluateDayFeasibility(day: DayPlan, availableMinutes = DEFAULT_ACTIVE_DAY_MINUTES): DayFeasibility {
  const poiMinutes = day.pois.reduce((total, poi) => total + poi.stayMinutes, 0);
  const travelMinutes = day.travelLegs.reduce((total, leg) => total + leg.durationMinutes, 0);
  // Give each change of place a small, explicit transition allowance.
  const bufferMinutes = Math.max(30, Math.max(0, day.pois.length - 1) * 15);
  const plannedMinutes = poiMinutes + travelMinutes + bufferMinutes;
  const remainingMinutes = availableMinutes - plannedMinutes;
  const level = plannedMinutes > availableMinutes ? 'overloaded'
    : plannedMinutes > availableMinutes - 45 ? 'tight'
      : plannedMinutes > availableMinutes - 180 ? 'balanced' : 'light';
  const label = level === 'overloaded' ? '过满，建议删减或拆分'
    : level === 'tight' ? '偏紧，尽量保留弹性'
      : level === 'balanced' ? '节奏适中' : '留白充足';
  return { day: day.day, poiMinutes, travelMinutes, bufferMinutes, plannedMinutes, availableMinutes, remainingMinutes, level, label };
}

export function formatPlanningDuration(minutes: number): string {
  const absolute = Math.abs(Math.round(minutes));
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return hours ? `${hours} 小时${rest ? ` ${rest} 分` : ''}` : `${rest} 分`;
}
