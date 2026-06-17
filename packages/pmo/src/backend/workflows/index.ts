import type { WorkflowContribution } from '@seta/agent-sdk';
import { DemoAnalyticsTraceInputSchema } from './demo-analytics-trace/schemas.ts';
import { demoAnalyticsTraceWorkflow } from './demo-analytics-trace/spec.ts';
import { IngestInputSchema } from './ingest-data/schemas.ts';
import { ingestDataWorkflow } from './ingest-data/spec.ts';

export const pmoWorkflows: WorkflowContribution[] = [
  {
    id: 'pmo.ingestData',
    build: (_mastra) => {
      // Register the workflow on the Mastra instance at boot time
      // The actual registration is handled by the agent engine
      return ingestDataWorkflow;
    },
    inputSchema: IngestInputSchema,
  },
  {
    id: 'pmo.demoAnalyticsTrace',
    build: (_mastra) => demoAnalyticsTraceWorkflow,
    inputSchema: DemoAnalyticsTraceInputSchema,
  },
];
