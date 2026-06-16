import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import { runDynamicIngestOrchestrator } from './orchestrator.ts';
import type { IngestDataV2Output } from './schemas.ts';
import {
  DynamicPlannerResumeSchema,
  DynamicPlannerSuspendSchema,
  IngestDataV2InputSchema,
  IngestDataV2OutputSchema,
} from './schemas.ts';

const dynamicRuntimeStep = createStep({
  id: 'pmo.ingestDataV2.dynamicRuntime',
  description:
    'Executes planner-driven dynamic ingest runtime and suspends for review gates when needed.',
  inputSchema: IngestDataV2InputSchema,
  outputSchema: IngestDataV2OutputSchema,
  suspendSchema: DynamicPlannerSuspendSchema,
  resumeSchema: DynamicPlannerResumeSchema,
  execute: async ({ inputData, resumeData, requestContext, suspend, runId }) => {
    const tenantFromContext = requestContext.get('tenant_id');
    const tenantId =
      typeof tenantFromContext === 'string' && tenantFromContext.length > 0
        ? tenantFromContext
        : (inputData.tenantId ?? '');
    if (!tenantId) {
      throw new Error('missing_tenant_id_for_pmo_v2');
    }

    const actor = requestContext.get('actor') as { user_id?: string } | undefined;
    const userId = actor?.user_id ?? '';

    const result = await runDynamicIngestOrchestrator({
      ingestionSessionId: inputData.ingestionSessionId,
      fileKey: inputData.fileKey,
      tenantId,
      userId,
      runId,
      requestContext: requestContext as { get: (key: string) => unknown },
      resumeData,
    });

    if (result.kind === 'suspend') {
      return suspend(result.card);
    }

    const output: IngestDataV2Output = result.output;
    return output;
  },
});

export const ingestDataV2Workflow = createWorkflow({
  id: 'pmo.ingestData.v2',
  inputSchema: IngestDataV2InputSchema,
  outputSchema: IngestDataV2OutputSchema,
  retryConfig: { attempts: 2, delay: 1000 },
})
  .then(dynamicRuntimeStep)
  .commit();

export const ingestDataV2WorkflowSpec: WorkflowSpec = {
  domain: 'work',
  id: 'ingestDataV2',
  description:
    'Planner-driven PMO ingest workflow with dynamic runtime sequencing and HITL review per planner step.',
  inputSchema: IngestDataV2InputSchema,
  outputSchema: IngestDataV2OutputSchema,
  workflow: ingestDataV2Workflow,
  hitlSteps: ['pmo.ingestDataV2.dynamicRuntime'],
};
