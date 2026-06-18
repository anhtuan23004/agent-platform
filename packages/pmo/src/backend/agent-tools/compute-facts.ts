import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { ensureFactsComputed } from '../analytics/ensure-facts-computed.ts';
import { tenantIdFromContext } from './context.ts';

const outputSchema = z.object({
  factCount: z.number().int(),
  memberCount: z.number().int(),
  weekIds: z.array(z.string()),
  thresholds: z.object({
    overbookThreshold: z.number(),
    overbookRedThreshold: z.number(),
    idleThreshold: z.number(),
    mismatchPctThreshold: z.number(),
    otMaxHoursPerWeek: z.number(),
  }),
});

export const pmoComputeMemberWeekFactsTool = defineAgentTool({
  id: 'pmo_computeMemberWeekFacts',
  name: 'Recompute Utilization Facts',
  description:
    'Recompute the member × week utilization read-model from the published PMO ' +
    'data (resource allocations, timesheets, leave, calendar). Dedup-, part-time-, ' +
    'holiday-, leave-, and onboarding-aware.\n\n' +
    'Run this once after a PMO ingest publishes, before calling ' +
    'pmo_detectOverbookIdle or pmo_detectMismatch.',
  input: z.object({}),
  output: outputSchema,
  rbac: 'pmo.data.read',
  execute: async (_input, ctx) => {
    const tenantId = tenantIdFromContext(ctx);
    const result = await ensureFactsComputed(tenantId, { force: true });
    return {
      factCount: result.factCount,
      memberCount: result.memberCount,
      weekIds: result.weekIds,
      thresholds: result.thresholds,
    };
  },
});
