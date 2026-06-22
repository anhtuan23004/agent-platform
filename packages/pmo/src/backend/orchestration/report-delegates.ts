import type { AgentToolContext } from '@seta/agent-sdk';
import { tenantIdFromContext } from '../agent-tools/context.ts';
import type { ResolvedDateRange } from '../agent-tools/resolve-analytics-scope.ts';
import { generatePmoReport } from '../analytics/report.ts';
import { filterReportOutputByWeek } from '../reporting/recommendations/filter-by-week.ts';

export async function runPmoReportSummary(
  tenantId: string,
  scope: { ingestionSessionId?: string; dateRange: ResolvedDateRange },
) {
  return generatePmoReport({
    tenantId,
    dateRange: scope.dateRange,
    reportTypes: ['idle_members', 'overbook_members'],
    ...(scope.ingestionSessionId
      ? {
          ingestionSessionId: scope.ingestionSessionId,
          reportSource: 'published_batch' as const,
        }
      : {}),
  });
}

export async function runPmoRebalanceCandidates(
  input: {
    sourceMemberId?: string;
    weekId?: string;
    opportunityId?: string;
    recommendationCandidateCount?: number;
  },
  ctx: AgentToolContext,
  scope: { ingestionSessionId?: string; dateRange: ResolvedDateRange },
) {
  const tenantId = tenantIdFromContext(ctx);

  const report = await generatePmoReport({
    tenantId,
    dateRange: scope.dateRange,
    reportTypes: ['overbook_members'],
    recommendationCandidateCount: input.recommendationCandidateCount,
    ...(scope.ingestionSessionId
      ? {
          ingestionSessionId: scope.ingestionSessionId,
          reportSource: 'published_batch' as const,
        }
      : {}),
  });

  let findings = report.findings.filter((finding) => finding.issueType === 'overbook');
  let recommendations = report.recommendations;

  if (input.weekId) {
    ({ findings, recommendations } = filterReportOutputByWeek(
      { findings: report.findings, recommendations },
      input.weekId,
    ));
  }

  recommendations = recommendations.filter(
    (group) =>
      (!input.sourceMemberId || group.sourceMemberId === input.sourceMemberId) &&
      (!input.opportunityId || group.opportunityId === input.opportunityId),
  );
  const sourceMemberIds = new Set(recommendations.map((group) => group.sourceMemberId));
  findings = findings.filter(
    (finding) =>
      (!input.sourceMemberId || finding.memberId === input.sourceMemberId) &&
      (recommendations.length === 0 || sourceMemberIds.has(finding.memberId)),
  );
  const memberIds = new Set([
    ...findings.map((finding) => finding.memberId),
    ...recommendations.flatMap((group) => [
      group.sourceMemberId,
      ...group.recommendations.map((recommendation) => recommendation.targetMemberId),
    ]),
  ]);

  return {
    dateRange: report.dateRange,
    members: report.members.filter((member) => memberIds.has(member.memberId)),
    findings,
    recommendations,
  };
}
