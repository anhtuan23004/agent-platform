import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { generateReport } from '../reporting/generate-report.ts';
import { tenantIdFromContext, userIdFromContext } from './context.ts';

export const reportTypeSchema = z.enum(['idle_members', 'overbook_members']);

export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const actionCodeSchema = z.enum([
  'REBALANCE_ALLOCATION',
  'REVIEW_WITH_LINE_MANAGER',
  'CHECK_MISSING_TIMESHEET',
  'CONFIRM_APPROVED_OT',
  'VALIDATE_TRAINING_TIME',
  'REVIEW_RA_TIMESHEET_MISMATCH',
  'NO_ACTION',
]);

export const suggestedActionSchema = z.object({
  actionCode: actionCodeSchema,
  templateText: z.string(),
  primary: z.boolean(),
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
});

export const recommendationSchema = z.object({
  type: z.literal('rebalance'),
  sourceMemberId: z.string(),
  targetMemberId: z.string(),
  weekId: z.string(),
  projectId: z.string(),
  transferHours: z.number().positive(),
  score: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  rankWithinSource: z.number().int().positive(),
  portfolioSelected: z.boolean(),
  mutuallyExclusiveAlternative: z.boolean(),
  beforeAfter: z.object({
    sourceBeforeBusyRate: z.number(),
    sourceAfterBusyRate: z.number(),
    targetBeforeBusyRate: z.number(),
    targetAfterBusyRate: z.number(),
  }),
  scoreBreakdown: z.object({
    skillCoverage: z.number(),
    taskHistorySimilarity: z.number(),
    capacityFit: z.number(),
    projectContext: z.number(),
  }),
  evidence: z.object({
    matchedSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
    similarPastTasks: z.array(z.string()),
    capacityReason: z.string(),
  }),
  recommendationDegraded: z.boolean(),
  dataQualityFlags: z.array(z.string()),
});

export const recommendationGroupSchema = z.object({
  sourceMemberId: z.string(),
  weekId: z.string(),
  severity: z.enum(['yellow', 'red']),
  requiredReductionHours: z.number().nonnegative(),
  status: z.enum(['full_solution', 'partial_relief', 'no_valid_rebalance_found']),
  recommendations: z.array(recommendationSchema),
  noResultReasons: z.array(z.string()),
  recommendationDegraded: z.boolean(),
  dataQualityFlags: z.array(z.string()),
  evidenceVersions: z.object({
    sourceVersions: z.array(z.string()),
    embeddingModelIds: z.array(z.string()),
    embeddingSourceHashes: z.array(z.string()),
  }),
});

export const projectionFreshnessSchema = z.object({
  skillsCount: z.number().int().nonnegative(),
  taskHistoryCount: z.number().int().nonnegative(),
  lastSyncedAt: z.string().datetime().nullable(),
  degraded: z.boolean(),
});

export const recommendationDataQualitySchema = z.object({
  recommendationDegraded: z.boolean(),
  flags: z.array(z.string()),
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
    projectionFreshness: projectionFreshnessSchema,
    dataQuality: recommendationDataQualitySchema,
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
    return {
      reportRunId: result.reportRunId,
      status: 'completed' as const,
      statusUrl: `/api/pmo/v1/reports/${result.reportRunId}`,
      artifacts: { htmlAvailable: false, pdfAvailable: false },
      ...result.report,
    };
  },
});
