// ── Week / date helpers (pure) ───────────────────────────────────────────────

import type { WeekRow } from './types.ts';

/** A calendar date belongs to a week when week_start ≤ date ≤ week_end (inclusive). */
export function dateInWeek(date: Date, week: WeekRow): boolean {
  const t = date.getTime();
  return t >= week.week_start.getTime() && t <= week.week_end.getTime();
}

/** An allocation is active in a week when its [start,end] overlaps [week_start,week_end]. */
export function allocationActiveInWeek(start: Date, end: Date, week: WeekRow): boolean {
  return start.getTime() <= week.week_end.getTime() && end.getTime() >= week.week_start.getTime();
}

/** Sorted ascending by week_start. */
export function sortWeeks(weeks: WeekRow[]): WeekRow[] {
  return [...weeks].sort((a, b) => a.week_start.getTime() - b.week_start.getTime());
}
