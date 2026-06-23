import type { GeneratePmoReportOutput } from '../report-output.ts';
import type { RebalanceRecommendationGroup } from './contracts.ts';

export interface WeekBounds {
  weekId: string;
  weekStart: string;
  weekEnd: string;
}

export function resolveWeekBounds(
  weekId: string,
  findings: GeneratePmoReportOutput['findings'],
): WeekBounds | null {
  for (const finding of findings) {
    for (const week of finding.issueWeeks ?? []) {
      if (week.weekId !== weekId) continue;
      if (!week.weekStart || !week.weekEnd) continue;
      return { weekId, weekStart: week.weekStart, weekEnd: week.weekEnd };
    }
  }
  return null;
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

export function findingHasWeekEvidence(
  finding: GeneratePmoReportOutput['findings'][number],
  weekId: string,
): boolean {
  return finding.issueWeeks?.some((week) => week.weekId === weekId) ?? false;
}

export function filterReportOutputByWeek(
  report: Pick<GeneratePmoReportOutput, 'findings' | 'recommendations'>,
  weekId: string,
): Pick<GeneratePmoReportOutput, 'findings' | 'recommendations'> {
  const bounds = resolveWeekBounds(weekId, report.findings);
  if (!bounds) {
    throw new Error(`unknown_week_id:${weekId}`);
  }

  const findings = report.findings.filter(
    (finding) => finding.issueType === 'overbook' && findingHasWeekEvidence(finding, weekId),
  );
  const sourceMemberIds = new Set(findings.map((finding) => finding.memberId));
  const recommendations = report.recommendations.filter(
    (group) =>
      sourceMemberIds.has(group.sourceMemberId) && recommendationGroupOverlapsWeek(group, bounds),
  );

  return { findings, recommendations };
}
