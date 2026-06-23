import type { AgentToolContext } from '@seta/agent-sdk';
import { tenantIdFromContext } from '../../agent-tools/context.ts';
import { pmoExplainFormulaTool } from '../../agent-tools/explain-formula.ts';
import {
  resolveAnalyticsScope,
  toLoadFactsDateRange,
} from '../../agent-tools/resolve-analytics-scope.ts';
import { loadFactsAndContext } from '../../analytics/findings-context.ts';
import {
  listFlaggedMembersFromDetectors,
  listMemberUtilization,
  loadMemberUtilizationDetail,
} from '../../analytics/list-member-utilization.ts';
import { verifyPublishedSession } from '../../reporting/generate-report.ts';
import { formatMethodologySummary } from '../format-methodology-summary.ts';
import { runPmoRebalanceCandidates, runPmoReportSummary } from '../report-delegates.ts';
import type { PmoUtilizationQueryInput, PmoUtilizationQueryOutput } from '../schemas.ts';

const CLARIFICATION_OPTIONS = [
  'PMO idle red: busyRate < 75%',
  'PMO idle yellow: busyRate < 85%',
  'Custom threshold — specify busyRateGt or busyRateLt (e.g. 0.5 for 50%)',
  'PMO flagged members only (overbook / idle / mismatch per SOP)',
];

export async function runUtilizationQuery(
  input: PmoUtilizationQueryInput,
  ctx: AgentToolContext,
): Promise<PmoUtilizationQueryOutput> {
  const tenantId = tenantIdFromContext(ctx);
  const scope = resolveAnalyticsScope(ctx, {
    ingestionSessionId: input.ingestionSessionId,
    dateRange: input.dateRange,
  });

  if (scope.ingestionSessionId) {
    await verifyPublishedSession(tenantId, scope.ingestionSessionId);
  }

  const loadDateRange = toLoadFactsDateRange(scope.dateRange);

  if (input.intent === 'count_members_by_busy_rate') {
    if (
      input.requireThreshold !== false &&
      input.busyRateGt === undefined &&
      input.busyRateLt === undefined
    ) {
      return {
        intent: input.intent,
        needsClarification: true,
        clarificationOptions: CLARIFICATION_OPTIONS,
      };
    }

    const listed = await listMemberUtilization({
      tenantId,
      ingestionSessionId: scope.ingestionSessionId,
      dateRange: loadDateRange,
      busyRateGt: input.busyRateGt,
      busyRateLt: input.busyRateLt,
    });

    return {
      intent: input.intent,
      memberCount: listed.summary.matchedMembers,
      members: listed.members,
      dateRange: listed.dateRange ?? scope.dateRange,
    };
  }

  if (input.intent === 'list_flagged_members') {
    const { facts, ctx: findingsCtx } = await loadFactsAndContext(tenantId, {
      ...(scope.ingestionSessionId ? { ingestionSessionId: scope.ingestionSessionId } : {}),
      ...(loadDateRange ? { dateRange: loadDateRange } : {}),
    });
    const members = listFlaggedMembersFromDetectors(facts, findingsCtx, input.flaggedTypes);
    return {
      intent: input.intent,
      memberCount: members.length,
      members,
      dateRange: scope.dateRange,
    };
  }

  if (input.intent === 'member_detail') {
    const memberId = input.memberId ?? input.sourceMemberId;
    if (!memberId) {
      return {
        intent: input.intent,
        needsClarification: true,
        clarificationOptions: ['Provide memberId (e.g. EMP-001)'],
      };
    }

    const detail = await loadMemberUtilizationDetail({
      tenantId,
      ingestionSessionId: scope.ingestionSessionId,
      dateRange: loadDateRange,
      memberId,
    });

    return {
      intent: input.intent,
      memberDetail: detail,
      dateRange: scope.dateRange,
    };
  }

  if (input.intent === 'report_summary') {
    if (!scope.dateRange) {
      return {
        intent: input.intent,
        needsClarification: true,
        clarificationOptions: [
          'Provide dateRange from/to (YYYY-MM-DD)',
          'Select a published upload with a reporting period in chat scope',
        ],
      };
    }

    const report = await runPmoReportSummary(tenantId, {
      ingestionSessionId: scope.ingestionSessionId,
      dateRange: scope.dateRange,
    });

    return {
      intent: input.intent,
      report,
      dateRange: scope.dateRange,
    };
  }

  if (input.intent === 'rebalance_candidates') {
    if (!scope.dateRange) {
      return {
        intent: input.intent,
        needsClarification: true,
        clarificationOptions: ['Provide dateRange from/to (YYYY-MM-DD)'],
      };
    }

    const rebalance = await runPmoRebalanceCandidates(
      {
        sourceMemberId: input.sourceMemberId,
        weekId: input.weekId,
        opportunityId: input.opportunityId,
      },
      ctx,
      {
        ingestionSessionId: scope.ingestionSessionId,
        dateRange: scope.dateRange,
      },
    );

    return {
      intent: input.intent,
      rebalance,
      dateRange: scope.dateRange,
    };
  }

  if (input.intent === 'explain_methodology') {
    const methodology = await pmoExplainFormulaTool.execute?.(
      { topic: input.formulaTopic ?? 'all' },
      ctx,
    );
    return {
      intent: input.intent,
      methodology,
      summary: methodology ? formatMethodologySummary(methodology) : undefined,
    };
  }

  return {
    intent: input.intent,
    needsClarification: true,
    clarificationOptions: ['Unsupported intent'],
  };
}
