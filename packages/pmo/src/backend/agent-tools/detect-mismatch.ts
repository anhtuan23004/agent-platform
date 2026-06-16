import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { detectMismatch } from '../analytics/findings.ts';
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

export const pmoDetectMismatchTool = defineAgentTool({
  id: 'pmo_detectMismatch',
  name: 'Detect Logged-vs-Planned Mismatch',
  description:
    'Detect members whose logged hours diverge from plan (effort consumption ' +
    'outside threshold). Full-leave weeks and approved-OT weeks are excluded ' +
    'from the ratio, so sanctioned overtime and approved leave are NOT flagged ' +
    "(see each finding's excludedWeeks for what was neutralised).\n\n" +
    'Call pmo_computeMemberWeekFacts first if data was just published.',
  input: z.object({}),
  output: z.object({ findings: z.array(findingSchema) }),
  rbac: 'pmo.data.read',
  execute: async (_input, ctx) => {
    const tenantId = tenantIdFromContext(ctx);
    const { facts, ctx: findingsCtx } = await loadFactsAndContext(tenantId);
    return { findings: detectMismatch(facts, findingsCtx) };
  },
});
