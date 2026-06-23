import type {
  PmoReportDateRange,
  PmoReportFinding,
  WorkloadReportOutput,
} from '../report-output.ts';
import type { RebalanceRecommendationGroup } from './contracts.ts';

export interface WeekBounds {
  weekId: string;
  weekStart: string;
  weekEnd: string;
}

export interface WorkloadRecommendationSlice {
  dateRange: PmoReportDateRange;
  findings: WorkloadReportOutput['findings'];
  recommendations: WorkloadReportOutput['recommendations'];
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid_report_date:${value}`);
  }
  return parsed;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseWeekOrdinal(weekId: string): number | null {
  const match = /^W(\d+)$/.exec(weekId.trim());
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

export function resolveWeekBounds(
  weekId: string,
  dateRange: PmoReportDateRange,
): WeekBounds | null {
  const ordinal = parseWeekOrdinal(weekId);
  if (!ordinal) return null;

  const rangeStart = parseIsoDate(dateRange.from);
  const rangeEnd = parseIsoDate(dateRange.to);
  const weekStart = addDays(rangeStart, (ordinal - 1) * 7);
  if (weekStart.getTime() > rangeEnd.getTime()) return null;

  const naturalWeekEnd = addDays(weekStart, 6);
  const weekEnd = naturalWeekEnd.getTime() > rangeEnd.getTime() ? rangeEnd : naturalWeekEnd;

  return {
    weekId,
    weekStart: formatIsoDate(weekStart),
    weekEnd: formatIsoDate(weekEnd),
  };
}

export function dateRangesOverlap(
  leftFrom: string,
  leftTo: string | null,
  rightFrom: string,
  rightTo: string,
): boolean {
  const endLeft = leftTo ?? leftFrom;
  return leftFrom <= rightTo && endLeft >= rightFrom;
}

export function parseOpportunityActivePeriod(opportunityId: string): {
  from: string;
  to: string;
} | null {
  const parts = opportunityId.split(':');
  if (parts.length < 5) return null;
  const from = parts[parts.length - 2] ?? '';
  const to = parts[parts.length - 1] ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return { from, to };
}

export function recommendationGroupOverlapsWeek(
  group: RebalanceRecommendationGroup,
  week: WeekBounds,
): boolean {
  const active = parseOpportunityActivePeriod(group.opportunityId);
  if (active) {
    return dateRangesOverlap(active.from, active.to, week.weekStart, week.weekEnd);
  }
  return dateRangesOverlap(
    group.evidenceWindow.from,
    group.evidenceWindow.to,
    week.weekStart,
    week.weekEnd,
  );
}

export function findingMatchesWeek(
  finding: PmoReportFinding,
  weekId: string,
  matchingSourceMemberIds: ReadonlySet<string>,
): boolean {
  if (finding.issueType !== 'overbook') return false;
  if (!matchingSourceMemberIds.has(finding.memberId)) return false;

  // The workload report no longer carries per-week positive evidence.
  // Keep the week filter conservative by excluding findings when the
  // selected week was explicitly suppressed for that member.
  return !finding.excludedWeeks.some((week) => week.weekId === weekId);
}

export function filterReportOutputByWeek(
  report: WorkloadRecommendationSlice,
  weekId: string,
): Pick<WorkloadReportOutput, 'findings' | 'recommendations'> {
  const bounds = resolveWeekBounds(weekId, report.dateRange);
  if (!bounds) {
    throw new Error(`unknown_week_id:${weekId}`);
  }

  const recommendations = report.recommendations.filter((group) =>
    recommendationGroupOverlapsWeek(group, bounds),
  );
  const sourceMemberIds = new Set(recommendations.map((group) => group.sourceMemberId));
  const findings = report.findings.filter((finding) =>
    findingMatchesWeek(finding, weekId, sourceMemberIds),
  );

  return { findings, recommendations };
}
