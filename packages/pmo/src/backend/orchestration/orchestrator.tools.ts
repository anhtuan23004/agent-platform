import {
  defineAgentTool,
  recordEntityExposure,
  type SpecializedAgentRunCtx,
} from '@seta/agent-sdk';
import { z } from 'zod';
import { tenantIdFromContext } from '../agent-tools/context.ts';
import { dateRangeSchema } from '../agent-tools/generate-report.ts';
import { ensureFactsComputed } from '../analytics/ensure-facts-computed.ts';
import type { makePmoGeneralAnswerAgent } from './agents/general-answer.ts';
import { runUtilizationQuery } from './agents/utilization-query.ts';
import { PmoUtilizationQueryIntent, PmoUtilizationQueryOutputSchema } from './schemas.ts';
import { makePmoCompareChangesTool } from './tools/pmo-compare-changes.tool.ts';
import { makePmoGenerateReportTool } from './tools/pmo-generate-report.tool.ts';
import { makePmoLoadContextTool } from './tools/pmo-load-context.tool.ts';
import { makePmoNormalizeToStagingTool } from './tools/pmo-normalize-to-staging.tool.ts';
import { makePmoProfileWorkbookTool } from './tools/pmo-profile-workbook.tool.ts';
import { makePmoProposedColumnMappingsTool } from './tools/pmo-propose-column-mappings.tool.ts';
import { makePmoPublishChangesTool } from './tools/pmo-publish-changes.tool.ts';
import { makePmoUpdateTaskStateTool } from './tools/pmo-update-task-state.tool.ts';

export interface PmoOrchestratorToolDeps {
  generalAnswer: ReturnType<typeof makePmoGeneralAnswerAgent>;
  userText: string;
  ctx: SpecializedAgentRunCtx;
}

export function makePmoOrchestratorTools(deps: PmoOrchestratorToolDeps) {
  const { generalAnswer, userText, ctx } = deps;

  const subCtx: SpecializedAgentRunCtx = {
    tenantId: ctx.tenantId,
    actorUserId: ctx.actorUserId,
    abortSignal: ctx.abortSignal,
    model: ctx.model,
    effectivePermissions: ctx.effectivePermissions,
  };

  const answerCtx: SpecializedAgentRunCtx = {
    ...subCtx,
    threadId: ctx.threadId,
    userMemory: ctx.userMemory,
  };

  const pmo_queryUtilization = defineAgentTool({
    id: 'pmo_queryUtilization',
    name: 'Query PMO Utilization',
    description: [
      'Primary PMO analytics entry point. Pick intent explicitly — do not guess slang.',
      '',
      'intent values:',
      '- count_members_by_busy_rate: count/list members with busyRateGt and/or busyRateLt (e.g. 1.0 for >100%).',
      '- list_flagged_members: SOP overbook/idle/mismatch findings only.',
      '- member_detail: one member week breakdown; pass memberId or sourceMemberId.',
      '- report_summary: idle+overbook report for dateRange (defaults from chat scope).',
      '- rebalance_candidates: rebalance suggestions for overbooked members.',
      '- explain_methodology: formulas, thresholds, exclusions — paste returned `summary` verbatim.',
      '',
      'When <<<PMO_ANALYTICS_SCOPE>>> is present, pass ingestionSessionId and use reporting dates from scope.',
      'If needsClarification is true, ask the user to pick an option — do not invent numbers.',
    ].join('\n'),
    input: z.object({
      intent: PmoUtilizationQueryIntent,
      dateRange: dateRangeSchema.optional(),
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
    }),
    output: PmoUtilizationQueryOutputSchema,
    rbac: 'pmo.data.read',
    execute: async (input, toolCtx) => {
      const result = await runUtilizationQuery(input, toolCtx);

      if (!result.needsClarification) {
        const memberId =
          input.memberId ??
          input.sourceMemberId ??
          result.members?.[0]?.memberId ??
          (result.memberDetail as { memberId?: string } | null | undefined)?.memberId;
        await recordEntityExposure(toolCtx as never, {
          ...(memberId ? { lastDiscussedMemberId: memberId } : {}),
          ...(result.members?.length
            ? {
                recentMembers: result.members.slice(0, 10).map((member) => ({
                  memberId: member.memberId,
                  label: member.memberId,
                })),
              }
            : {}),
          ...(result.dateRange ? { lastDateRange: result.dateRange } : {}),
          ...(input.ingestionSessionId ? { lastIngestionSessionId: input.ingestionSessionId } : {}),
        });
      }

      return result;
    },
  });

  const pmo_answerQuestion = defineAgentTool({
    id: 'pmo_answerQuestion',
    name: 'Answer PMO Question',
    description:
      'Answer a general or out-of-domain question in prose.\n\n' +
      'Use for: roles/org chart, staffing assignment redirects, ingest/publish redirects, ' +
      'conversational follow-ups that do NOT need utilization numbers.\n' +
      'Do NOT use for utilization counts — use pmo_queryUtilization.',
    input: z.object({}),
    output: z.object({ answer: z.string() }),
    execute: async () => {
      const res = await generalAnswer.run({ query: userText }, answerCtx);
      return res.result;
    },
  });

  const pmo_refreshUtilizationFacts = defineAgentTool({
    id: 'pmo_refreshUtilizationFacts',
    name: 'Refresh Utilization Facts',
    description:
      'Recompute member×week utilization facts after a publish or when detect/query tools return empty stale data.',
    input: z.object({}),
    output: z.object({
      factCount: z.number().int(),
      memberCount: z.number().int(),
      weekIds: z.array(z.string()),
    }),
    rbac: 'pmo.data.read',
    execute: async (_input, toolCtx) => {
      const tenantId = tenantIdFromContext(toolCtx);
      const result = await ensureFactsComputed(tenantId, { force: true });
      return {
        factCount: result.factCount,
        memberCount: result.memberCount,
        weekIds: result.weekIds,
      };
    },
  });

  return {
    pmo_queryUtilization,
    pmo_answerQuestion,
    pmo_refreshUtilizationFacts,
    pmo_profileWorkbook: makePmoProfileWorkbookTool(),
    pmo_proposeColumnMappings: makePmoProposedColumnMappingsTool(),
    pmo_normalizeToStaging: makePmoNormalizeToStagingTool(),
    pmo_compareChanges: makePmoCompareChangesTool(),
    pmo_publishChanges: makePmoPublishChangesTool(),
    pmo_generateReportIngest: makePmoGenerateReportTool(),
    pmo_loadContext: makePmoLoadContextTool(),
    pmo_updateTaskState: makePmoUpdateTaskStateTool(),
  };
}
