import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { generatePmoReport } from '../analytics/report.ts';
import { verifyPublishedSession } from '../reporting/generate-report.ts';
import { filterReportOutputByWeek } from '../reporting/recommendations/filter-by-week.ts';
import type { WorkloadReportOutput } from '../reporting/report-output.ts';
import { tenantIdFromContext } from './context.ts';

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const actionCodeSchema = z.enum([
  'REBALANCE_ALLOCATION',
  'REVIEW_WITH_LINE_MANAGER',
  'CHECK_MISSING_TIMESHEET',
  'CONFIRM_APPROVED_OT',
  'VALIDATE_TRAINING_TIME',
  'REVIEW_RA_TIMESHEET_MISMATCH',
  'NO_ACTION',
]);

const suggestedActionSchema = z.object({
  actionCode: actionCodeSchema,
  templateText: z.string(),
  primary: z.boolean(),
});

const findingExplanationSchema = z.object({
  summary: z.string(),
  riskTradeoffs: z.array(z.string()),
});

const recommendationExplanationSchema = z.object({
  summary: z.string(),
  riskTradeoffs: z.array(z.string()),
  topChoiceReason: z.string().nullable(),
  alternativesComparison: z.string().nullable(),
});

const findingSchema = z.object({
  memberId: z.string(),
  issueType: z.enum(['overbook', 'idle', 'mismatch_under', 'mismatch_over', 'ok']),
  ragColor: z.enum(['green', 'yellow', 'red', 'none']),
  busyRate: z.number().nullable(),
  effortConsumption: z.number().nullable(),
  detail: z.string(),
  excludedWeeks: z.array(z.object({ weekId: z.string(), reason: z.string() })),
  annotations: z.array(
    z.object({ weekId: z.string(), reason: z.enum(['approved_ot', 'training']) }),
  ),
  reviewRequired: z.boolean(),
  suggestedActionCode: actionCodeSchema,
  suggestedActions: z.array(suggestedActionSchema),
  metricEvidence: z.object({
    N01: z.number().nullable(),
    N02: z.number().nullable(),
    N03: z.number().nullable(),
    N04: z.number().nullable(),
    N05: z.number().nullable(),
    N06: z.number().nullable(),
    N12: z.number().nullable(),
  }),
  explanation: findingExplanationSchema.optional(),
});

const recommendationSchema = z.object({
  type: z.literal('rebalance'),
  sourceMemberId: z.string(),
  targetMemberId: z.string(),
  opportunityId: z.string(),
  projectId: z.string(),
  roleNeeded: z.string().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  transferPct: z.number().nonnegative(),
  transferHoursPerWeek: z.number().positive(),
  score: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  rankWithinOpportunity: z.number().int().positive(),
  portfolioSelected: z.boolean(),
  mutuallyExclusiveAlternative: z.boolean(),
  beforeAfter: z.object({
    sourceBeforeBusyRate: z.number(),
    sourceAfterBusyRate: z.number(),
    targetBeforeBusyRate: z.number(),
    targetAfterBusyRate: z.number(),
  }),
  scoreBreakdown: z.object({
    skillMatch: z.number(),
    historyMatch: z.number(),
    roleContextMatch: z.number(),
    capacityFit: z.number(),
    riskAdjustment: z.number(),
  }),
  evidence: z.object({
    matchedSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
    similarPastTasks: z.array(z.string()),
    sourceRiskFlags: z.array(z.string()),
    candidateRiskFlags: z.array(z.string()),
    rationale: z.string(),
  }),
  recommendationDegraded: z.boolean(),
  dataQualityFlags: z.array(z.string()),
});

const recommendationGroupSchema = z.object({
  opportunityId: z.string(),
  sourceMemberId: z.string(),
  projectId: z.string(),
  roleNeeded: z.string().nullable(),
  severity: z.enum(['warning', 'red']),
  evidenceWindow: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  planningPeriod: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  }),
  currentRaBusyRate: z.number().nonnegative(),
  targetRaBusyRate: z.number().nonnegative(),
  requiredReductionPct: z.number().nonnegative(),
  requiredReductionHoursPerWeek: z.number().nonnegative(),
  status: z.enum(['full_solution', 'partial_relief', 'no_valid_rebalance_found']),
  requiresRaConfirmation: z.boolean(),
  recommendations: z.array(recommendationSchema),
  noResultReasons: z.array(z.string()),
  recommendationDegraded: z.boolean(),
  dataQualityFlags: z.array(z.string()),
  explanation: recommendationExplanationSchema.optional(),
  evidenceVersions: z.object({
    sourceVersions: z.array(z.string()),
    embeddingModelIds: z.array(z.string()),
    embeddingSourceHashes: z.array(z.string()),
  }),
});

function assertWorkloadReport(
  report: Awaited<ReturnType<typeof generatePmoReport>>,
): WorkloadReportOutput {
  if (report.reportFamily !== 'workload') {
    throw new Error('agent_tool_forward_allocation_not_supported');
  }
  return report;
}

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

    const report = assertWorkloadReport(
      await generatePmoReport({
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
      }),
    );

    let findings = report.findings.filter((finding) => finding.issueType === 'overbook');
    let recommendations = report.recommendations;

    if (input.weekId) {
      ({ findings, recommendations } = filterReportOutputByWeek(
        { dateRange: report.dateRange, findings: report.findings, recommendations },
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
