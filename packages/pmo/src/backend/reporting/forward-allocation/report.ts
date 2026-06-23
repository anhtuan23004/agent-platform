import { ensureFactsComputed } from '../../analytics/ensure-facts-computed.ts';
import { buildFallbackForwardAllocationRationale } from '../explanations/report-explanations.ts';
import type { ForwardAllocationReportOutput, PmoReportDateRange } from '../report-output.ts';
import { generateForwardAllocationRecommendations } from './generate.ts';
import { loadForwardAllocationEvidence } from './load-evidence.ts';
import { buildMemberAvailabilityWindows } from './supply.ts';

function parseReportDate(value: string, label: 'from' | 'to'): Date {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) || Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid_report_date:${label}`);
  }
  return parsed;
}

export async function generateForwardAllocationReport(input: {
  tenantId: string;
  dateRange: PmoReportDateRange;
  planningDateRange?: PmoReportDateRange;
  recommendationCandidateCount?: number;
}): Promise<ForwardAllocationReportOutput> {
  const from = parseReportDate(input.dateRange.from, 'from');
  const to = parseReportDate(input.dateRange.to, 'to');
  if (from.getTime() > to.getTime()) throw new Error('invalid_report_date_range');
  const planningFrom = parseReportDate(
    input.planningDateRange?.from ?? input.dateRange.from,
    'from',
  );
  const planningTo = parseReportDate(input.planningDateRange?.to ?? input.dateRange.to, 'to');
  if (planningFrom.getTime() > planningTo.getTime()) throw new Error('invalid_report_date_range');

  const freshness = await ensureFactsComputed(input.tenantId, { force: false });
  const evidence = await loadForwardAllocationEvidence({
    tenantId: input.tenantId,
    evidenceFrom: from,
    evidenceTo: to,
    planningStart: planningFrom,
    planningEnd: planningTo,
  });
  const rows = generateForwardAllocationRecommendations({
    evidence,
    topN: input.recommendationCandidateCount,
  }).map((row) => ({
    ...row,
    explanation:
      row.explanation ??
      buildFallbackForwardAllocationRationale({
        type: row.type,
        recommendationMode: row.recommendationMode,
        suggestedAllocationHoursPerWeek: row.suggestedAllocationHoursPerWeek,
        targetProjectId: row.targetProjectId,
        score: row.score,
      }),
  }));
  const members = evidence.members
    .filter((member) => rows.some((row) => row.memberId === member.memberId))
    .map((member) => ({
      memberId: member.memberId,
      fullName: member.fullName,
      department: member.department,
      roleTitle: member.roleTitle,
    }))
    .sort((left, right) => left.memberId.localeCompare(right.memberId));
  const availabilityWindows = buildMemberAvailabilityWindows(evidence);

  return {
    reportFamily: 'forward_allocation',
    dateRange: {
      from: input.dateRange.from.slice(0, 10),
      to: input.dateRange.to.slice(0, 10),
    },
    planningHorizon: {
      from: (input.planningDateRange?.from ?? evidence.window.planningStart.toISOString()).slice(
        0,
        10,
      ),
      to: (input.planningDateRange?.to ?? evidence.window.planningEnd.toISOString()).slice(0, 10),
    },
    sourceVersion: {
      factsVersion: freshness.factsVersion,
      canonicalDataVersion: freshness.canonicalDataVersion,
      factsComputedAt: freshness.computedAt.toISOString(),
    },
    recommendationModeSummary: {
      demandBacked: rows.filter((row) => row.recommendationMode === 'demand_backed').length,
      inferred: rows.filter((row) => row.recommendationMode === 'inferred').length,
    },
    summary: {
      memberAvailabilityCount: availabilityWindows.length,
      activeDemandWindowCount: evidence.demandGaps.length,
      demandBackedRecommendationCount: rows.filter(
        (row) => row.recommendationMode === 'demand_backed',
      ).length,
      inferredRecommendationCount: rows.filter((row) => row.recommendationMode === 'inferred')
        .length,
      releaseWarningCount: rows.filter((row) => row.type === 'release_warning').length,
    },
    members,
    rows,
  };
}
