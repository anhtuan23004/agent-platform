import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { detectOverbookIdle } from '../analytics/findings.ts';
import { tenantIdFromContext } from './context.ts';
import { loadFactsAndContext } from './findings-context.ts';

const findingSchema = z.object({
  memberId: z.string(),
  issueType: z.enum(['overbook', 'idle', 'mismatch_under', 'mismatch_over', 'ok']),
  ragColor: z.enum(['green', 'yellow', 'red', 'none']),
  busyRate: z.number().nullable(),
  effortConsumption: z.number().nullable(),
  detail: z.string(),
  excludedWeeks: z.array(z.object({ weekId: z.string(), reason: z.string() })),
});

export const pmoDetectOverbookIdleTool = defineAgentTool({
  id: 'pmo_detectOverbookIdle',
  name: 'Detect Overbook & Idle',
  description:
    'Detect overbooked (busy > threshold) and idle (busy < threshold) members ' +
    'from the utilization read-model. Busy rate = planned ÷ available hours; ' +
    'available hours are part-time, holiday, and approved-absence aware, so ' +
    'onboarding gaps and valid edge cases are handled correctly.\n\n' +
    'Call pmo_computeMemberWeekFacts first if data was just published.',
  input: z.object({}),
  output: z.object({ findings: z.array(findingSchema) }),
  rbac: 'pmo.data.read',
  execute: async (_input, ctx) => {
    const tenantId = tenantIdFromContext(ctx);
    const { facts, ctx: findingsCtx } = await loadFactsAndContext(tenantId);
    return { findings: detectOverbookIdle(facts, findingsCtx) };
  },
});
