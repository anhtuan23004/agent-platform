import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { generateReport } from '../reporting/generate-report.ts';
import type { WorkloadReportOutput } from '../reporting/report-output.ts';
import { tenantIdFromContext, userIdFromContext } from './context.ts';

const reportTypeSchema = z.enum(['idle_members', 'overbook_members']);

export const dateRangeSchema = z.object({
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

export const findingSchema = z.object({
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

export const recommendationGroupSchema = z.object({
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

export const pmoGenerateReportTool = defineAgentTool({
  id: 'pmo_generateReport',
  name: 'Generate PMO Report',
  description:
    'Generate idle and overbook member reports from published PMO data for a confirmed date range. ' +
    'Use for: "generate idle report from 2026-06-01 to 2026-06-30", "show overbook members for June". ' +
    'Do NOT use before PMO ingest has been published; use pmo_computeMemberWeekFacts only for the persisted utilization read-model.',
  input: z.object({
    dateRange: dateRangeSchema,
    reportTypes: z.array(reportTypeSchema).default(['idle_members', 'overbook_members']),
    ingestionSessionId: z.string().uuid().optional(),
    recommendationCandidateCount: z.number().int().min(1).max(5).optional(),
  }),
  output: z.object({
    reportRunId: z.string().uuid(),
    status: z.enum(['queued', 'computing', 'rendering', 'completed', 'failed']),
    statusUrl: z.string(),
    artifacts: z.object({
      htmlAvailable: z.boolean(),
      pdfAvailable: z.boolean(),
    }),
    dateRange: dateRangeSchema,
    sourceVersion: z.object({
      factsVersion: z.string(),
      canonicalDataVersion: z.string(),
      factsComputedAt: z.string().datetime(),
    }),
    summary: z.object({
      memberCount: z.number().int(),
      overbookCount: z.number().int(),
      idleCount: z.number().int(),
      excludedWeekCount: z.number().int(),
    }),
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
    const result = await generateReport({
      tenantId,
      actorId: userIdFromContext(ctx),
      sourceMode: input.ingestionSessionId ? 'after_upload_publish' : 'canonical_db',
      ingestionSessionId: input.ingestionSessionId,
      dateRange: input.dateRange,
      reportTypes: input.reportTypes,
      recommendationCandidateCount: input.recommendationCandidateCount,
    });
    if (result.report.reportFamily !== 'workload') {
      throw new Error('agent_tool_forward_allocation_not_supported');
    }
    const report: WorkloadReportOutput = result.report;
    return {
      reportRunId: result.reportRunId,
      status: 'completed' as const,
      statusUrl: `/api/pmo/v1/reports/${result.reportRunId}`,
      artifacts: { htmlAvailable: false, pdfAvailable: false },
      ...report,
    };
  },
});
