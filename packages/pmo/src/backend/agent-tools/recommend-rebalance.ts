import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { generatePmoReport } from '../analytics/report.ts';
import { tenantIdFromContext } from './context.ts';
import {
  dateRangeSchema,
  findingSchema,
  projectionFreshnessSchema,
  recommendationDataQualitySchema,
  recommendationGroupSchema,
} from './generate-report.ts';

export const pmoRecommendRebalanceTool = defineAgentTool({
  id: 'pmo_recommendRebalance',
  name: 'Recommend PMO Rebalance',
  description:
    'Return deterministic PMO workload rebalance recommendations for overbooked members in a confirmed date range. ' +
    'Use for: "who can take Alice workload in W12", "recommend rebalance for EMP-042", ' +
    '"suggest allocation transfer candidates". Read-only; does not create report runs or mutate allocation.',
  input: z.object({
    dateRange: dateRangeSchema,
    sourceMemberId: z.string().min(1).optional(),
    weekId: z.string().min(1).optional(),
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
    dataQuality: recommendationDataQualitySchema,
    projectionFreshness: projectionFreshnessSchema,
  }),
  rbac: 'pmo.data.read',
  execute: async (input, ctx) => {
    const report = await generatePmoReport({
      tenantId: tenantIdFromContext(ctx),
      dateRange: input.dateRange,
      reportTypes: ['overbook_members'],
      recommendationCandidateCount: input.recommendationCandidateCount,
    });
    const recommendations = report.recommendations.filter(
      (group) =>
        (!input.sourceMemberId || group.sourceMemberId === input.sourceMemberId) &&
        (!input.weekId || group.weekId === input.weekId),
    );
    const sourceMemberIds = new Set(recommendations.map((group) => group.sourceMemberId));
    const findings = report.findings.filter(
      (finding) =>
        finding.issueType === 'overbook' &&
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
      dataQuality: report.dataQuality,
      projectionFreshness: report.projectionFreshness,
    };
  },
});
