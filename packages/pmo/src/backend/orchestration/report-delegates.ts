import type { AgentToolContext } from '@seta/agent-sdk';
import { tenantIdFromContext } from '../agent-tools/context.ts';
import type { ResolvedDateRange } from '../agent-tools/resolve-analytics-scope.ts';
import { generatePmoReport } from '../analytics/report.ts';
import { filterReportOutputByWeek } from '../reporting/recommendations/filter-by-week.ts';
<<<<<<< HEAD
=======
import type { GeneratePmoReportOutput, WorkloadReportOutput } from '../reporting/report-output.ts';

function assertWorkloadReport(report: GeneratePmoReportOutput): WorkloadReportOutput {
  if (report.reportFamily !== 'workload') {
    throw new Error('agent_tool_forward_allocation_not_supported');
  }
  return report;
}
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)

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

<<<<<<< HEAD
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
=======
  const report = assertWorkloadReport(
    await generatePmoReport({
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
    }),
  );
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)

  let findings = report.findings.filter((finding) => finding.issueType === 'overbook');
  let recommendations = report.recommendations;

  if (input.weekId) {
    ({ findings, recommendations } = filterReportOutputByWeek(
<<<<<<< HEAD
      { findings: report.findings, recommendations },
=======
      { dateRange: report.dateRange, findings: report.findings, recommendations },
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
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
