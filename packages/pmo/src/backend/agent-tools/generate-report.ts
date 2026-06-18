import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { generatePmoReport } from '../analytics/report.ts';
import { tenantIdFromContext } from './context.ts';

const reportTypeSchema = z.enum(['idle_members', 'overbook_members']);

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const findingSchema = z.object({
  memberId: z.string(),
  issueType: z.enum(['overbook', 'idle', 'mismatch_under', 'mismatch_over', 'ok']),
  ragColor: z.enum(['green', 'yellow', 'red', 'none']),
  busyRate: z.number().nullable(),
  effortConsumption: z.number().nullable(),
  detail: z.string(),
  excludedWeeks: z.array(z.object({ weekId: z.string(), reason: z.string() })),
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
  }),
  output: z.object({
    dateRange: dateRangeSchema,
    summary: z.object({
      memberCount: z.number().int(),
      overbookCount: z.number().int(),
      idleCount: z.number().int(),
      excludedWeekCount: z.number().int(),
    }),
    findings: z.array(findingSchema),
  }),
  rbac: 'pmo.data.read',
  execute: async (input, ctx) => {
    const tenantId = tenantIdFromContext(ctx);
    return generatePmoReport({
      tenantId,
      ingestionSessionId: input.ingestionSessionId,
      dateRange: input.dateRange,
      reportTypes: input.reportTypes,
    });
  },
});
