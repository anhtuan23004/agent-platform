import { z } from 'zod';

export const PmoUtilizationQueryIntent = z.enum([
  'count_members_by_busy_rate',
  'list_flagged_members',
  'member_detail',
  'report_summary',
  'rebalance_candidates',
  'explain_methodology',
]);
export type PmoUtilizationQueryIntent = z.infer<typeof PmoUtilizationQueryIntent>;

export const PmoUtilizationQueryInputSchema = z.object({
  intent: PmoUtilizationQueryIntent,
  dateRange: z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
  ingestionSessionId: z.string().uuid().optional(),
  memberId: z.string().min(1).optional(),
  busyRateGt: z.number().optional(),
  busyRateLt: z.number().optional(),
  flaggedTypes: z.array(z.enum(['overbook', 'idle', 'mismatch'])).optional(),
  sourceMemberId: z.string().min(1).optional(),
  weekId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  formulaTopic: z
    .enum([
      'busy_rate',
      'utilization',
      'billable_rate',
      'bench_rate',
      'overtime_ratio',
      'effort_consumption',
      'training_compliance',
      'thresholds',
      'exclusions',
      'all',
    ])
    .optional(),
  requireThreshold: z.boolean().optional(),
});

export type PmoUtilizationQueryInput = z.infer<typeof PmoUtilizationQueryInputSchema>;

export const ClarificationOptionSchema = z.string();

export const PmoUtilizationQueryOutputSchema = z.object({
  intent: PmoUtilizationQueryIntent,
  needsClarification: z.boolean().optional(),
  clarificationOptions: z.array(ClarificationOptionSchema).optional(),
  dateRange: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .optional(),
  memberCount: z.number().int().optional(),
  members: z
    .array(
      z.object({
        memberId: z.string(),
        busyRate: z.number().nullable(),
        effortConsumption: z.number().nullable(),
        issueType: z.string(),
        ragColor: z.string(),
      }),
    )
    .optional(),
  memberDetail: z.unknown().optional(),
  report: z.unknown().optional(),
  rebalance: z.unknown().optional(),
  methodology: z.unknown().optional(),
  summary: z.string().optional(),
});

export type PmoUtilizationQueryOutput = z.infer<typeof PmoUtilizationQueryOutputSchema>;

export const PmoOrchestratorInputSchema = z.object({
  userText: z.string(),
  taskId: z.string().nullable(),
});

export const PmoOrchestratorResultSchema = z.object({
  message: z.string(),
});

export const GeneralAnswerInputSchema = z.object({
  query: z.string(),
});

export const GeneralAnswerOutputSchema = z.object({
  answer: z.string(),
});
