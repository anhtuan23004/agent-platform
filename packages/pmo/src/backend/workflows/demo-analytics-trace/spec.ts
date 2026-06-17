import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  buildDemoAnalyticsResult,
  DemoAnalyticsNoDataError,
} from '../../analytics/demo-analytics.ts';
import { analyzeMembers, detectMismatch, detectOverbookIdle } from '../../analytics/findings.ts';
import type { CanonicalInputs } from '../../analytics/load-canonical.ts';
import { loadCanonicalInputs } from '../../analytics/load-canonical.ts';
import { buildMemberWeekFacts } from '../../analytics/member-week-facts.ts';
import { splitPmoPopulations } from '../../analytics/populations.ts';
import { resolveThresholds } from '../../analytics/thresholds.ts';
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

const buildFactsStep = createStep({
  id: 'pmo.demoTrace.buildFacts',
  description: 'Split PM/delivery populations, then compute delivery member×week facts.',
  inputSchema: z.custom<CanonicalInputs>(),
  outputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    thresholds: z.unknown(),
    facts: z.array(z.unknown()),
  }),
  execute: async ({ inputData }) => {
    const canonical = inputData as CanonicalInputs;
    const thresholds = resolveThresholds(canonical.configRows);
    const { deliveryMembers } = splitPmoPopulations(canonical.members, canonical.projects);
    const facts = buildMemberWeekFacts({
      members: deliveryMembers,
      allocations: canonical.allocations,
      timesheets: canonical.timesheets,
      leaves: canonical.leaves,
      weeks: canonical.weeks,
      thresholds,
    });
    return { canonical, thresholds, facts };
  },
});

const aggregateStep = createStep({
  id: 'pmo.demoTrace.aggregateMembers',
  description:
    'Aggregate facts to member grain (exclude holiday/leave/approved OT/training weeks).',
  inputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    thresholds: z.unknown(),
    facts: z.array(z.unknown()),
  }),
  outputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    thresholds: z.unknown(),
    facts: z.array(z.unknown()),
    analyses: z.array(z.unknown()),
  }),
  execute: async ({ inputData }) => {
    const canonical = inputData.canonical as CanonicalInputs;
    const facts = inputData.facts as unknown as ReturnType<typeof buildMemberWeekFacts>;
    const thresholds = resolveThresholds(canonical.configRows);
    const weeksById = new Map(canonical.weeks.map((w) => [w.week_id, w]));
    const ctx = { leaves: canonical.leaves, weeksById, thresholds };
    const analyses = analyzeMembers(facts, ctx);
    return { canonical, thresholds: inputData.thresholds, facts: inputData.facts, analyses };
  },
});

const findingsStep = createStep({
  id: 'pmo.demoTrace.detectFindings',
  description: 'Detect overbook/idle and mismatch findings at member grain.',
  inputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    thresholds: z.unknown(),
    facts: z.array(z.unknown()),
    analyses: z.array(z.unknown()),
  }),
  outputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    thresholds: z.unknown(),
    facts: z.array(z.unknown()),
    analyses: z.array(z.unknown()),
    overbookIdleFindings: z.array(z.unknown()),
    mismatchFindings: z.array(z.unknown()),
  }),
  execute: async ({ inputData }) => {
    const canonical = inputData.canonical as CanonicalInputs;
    const facts = inputData.facts as unknown as ReturnType<typeof buildMemberWeekFacts>;
    const thresholds = resolveThresholds(canonical.configRows);
    const weeksById = new Map(canonical.weeks.map((w) => [w.week_id, w]));
    const ctx = { leaves: canonical.leaves, weeksById, thresholds };
    return {
      canonical,
      thresholds: inputData.thresholds,
      facts: inputData.facts,
      analyses: inputData.analyses,
      overbookIdleFindings: detectOverbookIdle(facts, ctx),
      mismatchFindings: detectMismatch(facts, ctx),
    };
  },
});

const answerKeyStep = createStep({
  id: 'pmo.demoTrace.answerKey',
  description: 'Compare findings to the PMO_02 Answer Key for validation.',
  inputSchema: z.object({
    canonical: z.custom<CanonicalInputs>(),
    thresholds: z.unknown(),
    facts: z.array(z.unknown()),
    analyses: z.array(z.unknown()),
    overbookIdleFindings: z.array(z.unknown()),
    mismatchFindings: z.array(z.unknown()),
  }),
  outputSchema: DemoAnalyticsTraceOutputSchema,
  execute: async ({ inputData }) => {
    const canonical = inputData.canonical as CanonicalInputs;
    return {
      result: buildDemoAnalyticsResult(
        canonical.members,
        canonical.projects,
        canonical.allocations,
        canonical.timesheets,
        canonical.leaves,
        canonical.weeks,
        canonical.configRows,
      ),
    };
  },
});

export const demoAnalyticsTraceWorkflow = createWorkflow({
  id: 'pmo.demoAnalyticsTrace',
  description:
    'Traceable PMO utilization analytics (inputs → PM/delivery split → facts → aggregation → findings → answer key).',
  inputSchema: DemoAnalyticsTraceInputSchema,
  outputSchema: DemoAnalyticsTraceOutputSchema,
})
  .then(loadCanonicalStep)
  .then(buildFactsStep)
  .then(aggregateStep)
  .then(findingsStep)
  .then(answerKeyStep)
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
