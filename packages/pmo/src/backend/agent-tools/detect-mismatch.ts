import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { detectMismatch } from '../analytics/findings.ts';
import { loadFactsAndContext } from '../analytics/findings-context.ts';
import { verifyPublishedSession } from '../reporting/generate-report.ts';
import { analyticsIngestionSessionIdFromContext, tenantIdFromContext } from './context.ts';
import { dateRangeSchema } from './generate-report.ts';

const findingSchema = z.object({
  memberId: z.string(),
  issueType: z.enum(['overbook', 'idle', 'mismatch_under', 'mismatch_over', 'ok']),
  ragColor: z.enum(['green', 'yellow', 'red', 'none']),
  busyRate: z.number().nullable(),
  effortConsumption: z.number().nullable(),
  detail: z.string(),
  excludedWeeks: z.array(z.object({ weekId: z.string(), reason: z.string() })),
});

export const pmoDetectMismatchTool = defineAgentTool({
  id: 'pmo_detectMismatch',
  name: 'Detect Logged-vs-Planned Mismatch',
  description:
    'Detect members whose logged hours diverge from plan (effort consumption ' +
    'outside threshold). Holiday, full-leave, approved-OT, and training weeks ' +
    'are excluded from the member-level ratio, so valid edge cases are NOT ' +
    "flagged (see each finding's excludedWeeks for what was neutralised).\n\n" +
    'Call pmo_computeMemberWeekFacts first if data was just published.',
  input: z.object({
    dateRange: dateRangeSchema.optional(),
    ingestionSessionId: z.string().uuid().optional(),
    memberId: z.string().min(1).optional(),
  }),
  output: z.object({ findings: z.array(findingSchema) }),
  rbac: 'pmo.data.read',
  execute: async (input, ctx) => {
    const tenantId = tenantIdFromContext(ctx);
    const ingestionSessionId =
      input.ingestionSessionId ?? analyticsIngestionSessionIdFromContext(ctx);
    if (ingestionSessionId) {
      await verifyPublishedSession(tenantId, ingestionSessionId);
    }
    const { facts, ctx: findingsCtx } = await loadFactsAndContext(tenantId, {
      ...(input.dateRange
        ? {
            dateRange: {
              from: new Date(`${input.dateRange.from}T00:00:00.000Z`),
              to: new Date(`${input.dateRange.to}T00:00:00.000Z`),
            },
          }
        : {}),
      ...(ingestionSessionId ? { ingestionSessionId } : {}),
    });
    return {
      findings: detectMismatch(facts, findingsCtx).filter(
        (finding) => !input.memberId || finding.memberId === input.memberId,
      ),
    };
  },
});
