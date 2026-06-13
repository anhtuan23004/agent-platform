import { RequestContext } from '@mastra/core/request-context';
import { createS3FileStore } from '../ingestion/s3-file-store.ts';

interface StartIngestWorkflowInput {
  ingestionSessionId: string;
  fileKey: string;
  tenantId: string;
  userId: string;
  mastra: { getWorkflow(id: string): unknown };
}

/**
 * Starts the pmo.ingestData workflow with proper requestContext.
 * Fire-and-forget: workflow handles detect → confirm → normalize → publish.
 */
export async function startIngestWorkflow(input: StartIngestWorkflowInput): Promise<string | null> {
  const { ingestionSessionId, fileKey, tenantId, userId, mastra } = input;

  const workflow = (mastra.getWorkflow('pmo.ingestData') ?? mastra.getWorkflow('ingestData')) as
    | { createRun(): Promise<{ runId: string; start(opts: unknown): Promise<unknown> }> }
    | undefined;

  if (!workflow) {
    console.warn('[pmo] pmo.ingestData workflow not found on Mastra instance');
    return null;
  }

  const run = await workflow.createRun();

  // Build requestContext with file store + actor info
  const bucket = process.env.S3_BUCKET ?? 'seta-uploads';
  const requestContext = new RequestContext();
  requestContext.set('pmoFileStore', createS3FileStore(bucket));
  requestContext.set('fileKey', fileKey);
  requestContext.set('tenant_id', tenantId);
  requestContext.set('actor', { type: 'user' as const, user_id: userId });

  const workflowInput = {
    ingestionSessionId,
    fileKey,
    tenantId,
  };

  // Fire-and-forget: workflow handles HITL via suspend/resume
  void run.start({ inputData: workflowInput, requestContext });

  return run.runId;
}
