import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  buildDemoAnalyticsResult,
  DemoAnalyticsNoDataError,
} from '../../analytics/demo-analytics.ts';
import { ensureFactsComputed } from '../../analytics/ensure-facts-computed.ts';
import type { FindingsContext } from '../../analytics/findings.ts';
import { analyzeMembers, detectMismatch, detectOverbookIdle } from '../../analytics/findings.ts';
import { loadFactsAndContext } from '../../analytics/findings-context.ts';
import type { CanonicalInputs } from '../../analytics/load-canonical.ts';
import { loadCanonicalInputs } from '../../analytics/load-canonical.ts';
import type { MemberWeekFact } from '../../analytics/types.ts';
import { DemoAnalyticsTraceInputSchema, DemoAnalyticsTraceOutputSchema } from './schemas.ts';

function tenantIdFromRequestContext(requestContext: { get: (k: string) => unknown }): string {
  const tenantId = requestContext.get('tenant_id');
  if (typeof tenantId !== 'string' || tenantId.length === 0)
    throw new Error('missing_tenant_context');
  return tenantId;
}

const loadCanonicalStep = createStep({
  id: 'pmo.demoTrace.loadCanonical',
  description: 'Load canonical PMO inputs (pmo.* tables, is_active=true).',
  inputSchema: DemoAnalyticsTraceInputSchema,
  outputSchema: z.custom<CanonicalInputs>(),
  execute: async ({ requestContext }) => {
    const tenantId = tenantIdFromRequestContext(requestContext);
    const canonical = await loadCanonicalInputs(tenantId);
    if (canonical.members.length === 0 || canonical.weeks.length === 0) {
      throw new DemoAnalyticsNoDataError();
    }
    return canonical;
  },
});

const computeFactsStep = createStep({
  id: 'pmo.demoTrace.computeFacts',
  description: 'Persist member×week facts from canonical (production path).',
  inputSchema: z.custom<CanonicalInputs>(),
  outputSchema: z.custom<CanonicalInputs>(),
  execute: async ({ inputData, requestContext }) => {
    const tenantId = tenantIdFromRequestContext(requestContext);
    await ensureFactsComputed(tenantId, { force: true });
    return inputData as CanonicalInputs;
  },
});

const aggregateStep = createStep({
  id: 'pmo.demoTrace.aggregateMembers',
  description:
    'Load persisted facts and aggregate to member grain (exclude holiday/leave/approved OT/training weeks).',
  inputSchema: z.custom<CanonicalInputs>(),
  outputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    facts: z.array(z.unknown()),
    analyses: z.array(z.unknown()),
    ctx: z.unknown(),
  }),
  execute: async ({ inputData, requestContext }) => {
    const tenantId = tenantIdFromRequestContext(requestContext);
    const canonical = inputData as CanonicalInputs;
    const { facts, ctx } = await loadFactsAndContext(tenantId);
    const analyses = analyzeMembers(facts, ctx);
    return { canonical, facts, analyses, ctx };
  },
});

const findingsStep = createStep({
  id: 'pmo.demoTrace.detectFindings',
  description: 'Detect overbook/idle and mismatch findings at member grain.',
  inputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    facts: z.array(z.unknown()),
    analyses: z.array(z.unknown()),
    ctx: z.unknown(),
  }),
  outputSchema: DemoAnalyticsTraceOutputSchema,
  execute: async ({ inputData }) => {
    const canonical = inputData.canonical as CanonicalInputs;
    const facts = inputData.facts as MemberWeekFact[];
    const ctx = inputData.ctx as FindingsContext;
    detectOverbookIdle(facts, ctx);
    detectMismatch(facts, ctx);
    return {
      result: buildDemoAnalyticsResult(canonical),
    };
  },
});

export const demoAnalyticsTraceWorkflow = createWorkflow({
  id: 'pmo.demoAnalyticsTrace',
  description:
    'Traceable PMO utilization analytics (canonical → persist facts → aggregation → findings).',
  inputSchema: DemoAnalyticsTraceInputSchema,
  outputSchema: DemoAnalyticsTraceOutputSchema,
})
  .then(loadCanonicalStep)
  .then(computeFactsStep)
  .then(aggregateStep)
  .then(findingsStep)
  .commit();

export const demoAnalyticsTraceWorkflowSpec: WorkflowSpec = {
  id: 'pmo.demoAnalyticsTrace',
  domain: 'work',
  description:
    'Runs PMO utilization analytics as a workflow with step-by-step outputs for tracing PMs, delivery members, project membership, and findings.',
  inputSchema: DemoAnalyticsTraceInputSchema,
  outputSchema: DemoAnalyticsTraceOutputSchema,
  workflow: demoAnalyticsTraceWorkflow,
  hitlSteps: [],
};
