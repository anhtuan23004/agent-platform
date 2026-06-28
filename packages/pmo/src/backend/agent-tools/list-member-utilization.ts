import { defineAgentTool, recordEntityExposure } from '@seta/agent-sdk';
import { z } from 'zod';
import { listMemberUtilization } from '../analytics/list-member-utilization.ts';
import { verifyPublishedSession } from '../reporting/generate-report.ts';
import { tenantIdFromContext } from './context.ts';
import { dateRangeSchema } from './generate-report.ts';
import { resolveAnalyticsScope, toLoadFactsDateRange } from './resolve-analytics-scope.ts';

const memberRowSchema = z.object({
  memberId: z.string(),
  fullName: z.string().nullable(),
  department: z.string().nullable(),
  roleTitle: z.string().nullable(),
  busyRate: z.number().nullable(),
  effortConsumption: z.number().nullable(),
  issueType: z.enum(['overbook', 'idle', 'mismatch_under', 'mismatch_over', 'ok']),
  ragColor: z.enum(['green', 'yellow', 'red', 'none']),
  excludedWeekCount: z.number().int(),
  detail: z.string().nullable(),
  explanation: z
    .object({
      summary: z.string(),
      riskTradeoffs: z.array(z.string()),
    })
    .nullable(),
});

export const pmoListMemberUtilizationTool = defineAgentTool({
  id: 'pmo_listMemberUtilization',
  name: 'List Member Utilization',
  description:
    'List member-level busy rate and effort consumption with optional filters. ' +
    'Use for counts or lists at arbitrary busy-rate thresholds (e.g. busyRateGt=1.0 for >100%). ' +
    'Defaults date range and ingestion session from PMO chat analytics scope when omitted.',
  input: z.object({
    dateRange: dateRangeSchema.optional(),
    ingestionSessionId: z.string().uuid().optional(),
    memberId: z.string().min(1).optional(),
    busyRateGt: z.number().optional(),
    busyRateLt: z.number().optional(),
    issueTypes: z.array(z.enum(['overbook', 'idle', 'ok', 'all'])).optional(),
  }),
  output: z.object({
    members: z.array(memberRowSchema),
    summary: z.object({
      totalMembers: z.number().int(),
      matchedMembers: z.number().int(),
    }),
    dateRange: dateRangeSchema.optional(),
  }),
  rbac: 'pmo.data.read',
  execute: async (input, ctx) => {
    const tenantId = tenantIdFromContext(ctx);
    const scope = resolveAnalyticsScope(ctx, {
      ingestionSessionId: input.ingestionSessionId,
      dateRange: input.dateRange,
    });
    if (scope.ingestionSessionId) {
      await verifyPublishedSession(tenantId, scope.ingestionSessionId);
    }

    const result = await listMemberUtilization({
      tenantId,
      ingestionSessionId: scope.ingestionSessionId,
      dateRange: toLoadFactsDateRange(scope.dateRange),
      memberId: input.memberId,
      busyRateGt: input.busyRateGt,
      busyRateLt: input.busyRateLt,
      issueTypes: input.issueTypes,
    });

    if (result.members.length > 0) {
      await recordEntityExposure(ctx as never, {
        lastDiscussedMemberId: result.members[0]?.memberId ?? null,
        recentMembers: result.members.slice(0, 10).map((member) => ({
          memberId: member.memberId,
          label: member.fullName ?? member.memberId,
        })),
        ...(scope.dateRange ? { lastDateRange: scope.dateRange } : {}),
        ...(scope.ingestionSessionId ? { lastIngestionSessionId: scope.ingestionSessionId } : {}),
      });
    }

    return result;
  },
});
