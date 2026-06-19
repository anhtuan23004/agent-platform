import { RequestContext } from '@mastra/core/request-context';
import { RC_THREAD_ID } from '@seta/agent-sdk';
import { createS3FileStore } from '../ingestion/s3-file-store.ts';

export interface StartIngestWorkflowInput {
  ingestionSessionId: string;
  fileKey?: string;
  tenantId: string;
  userId: string;
  mastra: { getWorkflow(id: string): unknown };
  /** Chat thread that should surface workflow gate approvals. */
  threadId?: string;
  reportingPeriodKey?: string;
  reportingPeriodStart?: string;
  reportingPeriodEnd?: string;
}

/**
 * Starts PMO ingest workflow with proper requestContext.
 * Fire-and-forget: workflow handles detect → confirm → normalize → publish.
 */
export async function startIngestWorkflow(input: StartIngestWorkflowInput): Promise<string | null> {
  const {
    ingestionSessionId,
    fileKey,
    tenantId,
    userId,
    mastra,
    threadId,
    reportingPeriodKey,
    reportingPeriodStart,
    reportingPeriodEnd,
  } = input;

  const workflow = (mastra.getWorkflow('pmo.ingestData.v2') ??
    mastra.getWorkflow('ingestDataV2')) as
    | { createRun(): Promise<{ runId: string; start(opts: unknown): Promise<unknown> }> }
    | undefined;

  if (!workflow) {
    console.warn('[pmo] PMO ingest workflow not found on Mastra instance', {
      workflowId: 'pmo.ingestData.v2',
    });
    return null;
  }

  const run = await workflow.createRun();

  const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
  const requestContext = new RequestContext();
  requestContext.set('pmoFileStore', createS3FileStore(bucket));
  if (fileKey) requestContext.set('fileKey', fileKey);
  requestContext.set('tenant_id', tenantId);
  requestContext.set('actor', { type: 'user' as const, user_id: userId });
  requestContext.set('started_via', 'chat');
  if (threadId) {
    requestContext.set(RC_THREAD_ID, threadId);
    requestContext.set('thread_id', threadId);
    requestContext.set('parent_thread_id', threadId);
  }

  const workflowInput = {
    ingestionSessionId,
    fileKey,
    tenantId,
    ...(reportingPeriodKey ? { reportingPeriodKey } : {}),
    ...(reportingPeriodStart ? { reportingPeriodStart } : {}),
    ...(reportingPeriodEnd ? { reportingPeriodEnd } : {}),
  };

  void run.start({ inputData: workflowInput, requestContext });

  return run.runId;
}
