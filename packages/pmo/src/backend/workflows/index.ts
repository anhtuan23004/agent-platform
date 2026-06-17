import type { WorkflowContribution } from '@seta/agent-sdk';
import { DemoAnalyticsTraceInputSchema } from './demo-analytics-trace/schemas.ts';
import { demoAnalyticsTraceWorkflow } from './demo-analytics-trace/spec.ts';
import { IngestDataV2InputSchema } from './ingest-data-v2/schemas.ts';
import { ingestDataV2Workflow } from './ingest-data-v2/spec.ts';

export const pmoWorkflows: WorkflowContribution[] = [
  {
    id: 'pmo.ingestData.v2',
    build: (_mastra) => {
      // Register the dynamic runtime workflow on the Mastra instance at boot time.
      return ingestDataV2Workflow;
    },
    inputSchema: IngestDataV2InputSchema,
  },
  {
    id: 'pmo.demoAnalyticsTrace',
    build: (_mastra) => demoAnalyticsTraceWorkflow,
    inputSchema: DemoAnalyticsTraceInputSchema,
  },
];
