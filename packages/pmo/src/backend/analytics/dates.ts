// ── Week / date helpers (pure) ───────────────────────────────────────────────

import type { WeekRow } from './types.ts';

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY_MS = 86_400_000;

function inclusiveCalendarDays(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

/**
 * Share of a calendar week that falls inside a reporting range (0–1).
 * Used to prorate planned/available hours when the range cuts through week boundaries.
 */
export function weekCoverageFraction(week: WeekRow, range?: DateRange): number {
  if (!range) return 1;
  const clipStart = Math.max(week.week_start.getTime(), range.from.getTime());
  const clipEnd = Math.min(week.week_end.getTime(), range.to.getTime());
  if (clipEnd < clipStart) return 0;
  const overlapDays = inclusiveCalendarDays(new Date(clipStart), new Date(clipEnd));
  const weekDays = inclusiveCalendarDays(week.week_start, week.week_end);
  if (weekDays <= 0) return 0;
  return overlapDays / weekDays;
}

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
