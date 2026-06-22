import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { generatePmoReport } from '../analytics/report.ts';
import { verifyPublishedSession } from '../reporting/generate-report.ts';
import { filterReportOutputByWeek } from '../reporting/recommendations/filter-by-week.ts';
import { tenantIdFromContext } from './context.ts';
import { dateRangeSchema, findingSchema, recommendationGroupSchema } from './generate-report.ts';

export const pmoRecommendRebalanceTool = defineAgentTool({
  id: 'pmo_recommendRebalance',
  name: 'Recommend PMO Rebalance',
  description:
    'Return deterministic PMO workload rebalance recommendations for overbooked members in a confirmed date range. ' +
    'Use for: "who can take Alice workload in W12", "recommend rebalance for EMP-042", ' +
    '"suggest allocation transfer candidates". Read-only; does not create report runs or mutate allocation. ' +
    'When chat context includes an ingestionSessionId from a published upload, pass it to scope results to that batch only. ' +
    'Optional weekId (e.g. W3) narrows overbook context to that calendar week; recommendations remain forward-looking.',
  input: z.object({
    dateRange: dateRangeSchema,
    ingestionSessionId: z.string().uuid().optional(),
    sourceMemberId: z.string().min(1).optional(),
    weekId: z.string().min(1).optional(),
    opportunityId: z.string().min(1).optional(),
    recommendationCandidateCount: z.number().int().min(1).max(5).optional(),
  }),
  output: z.object({
    dateRange: dateRangeSchema,
    members: z.array(
      z.object({
        memberId: z.string(),
        fullName: z.string(),
        department: z.string().nullable(),
        roleTitle: z.string().nullable(),
      }),
    ),
    findings: z.array(findingSchema),
    recommendations: z.array(recommendationGroupSchema),
  }),
  rbac: 'pmo.data.read',
  execute: async (input, ctx) => {
    const tenantId = tenantIdFromContext(ctx);
    if (input.ingestionSessionId) {
      await verifyPublishedSession(tenantId, input.ingestionSessionId);
    }
    const report = await generatePmoReport({
      tenantId,
      dateRange: input.dateRange,
      reportTypes: ['overbook_members'],
      recommendationCandidateCount: input.recommendationCandidateCount,
      ...(input.ingestionSessionId
        ? {
            ingestionSessionId: input.ingestionSessionId,
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
  },
});
