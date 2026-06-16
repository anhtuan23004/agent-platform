import { buildPublishReviewCard } from '../cards.ts';
import { shouldBlockPublishApprove } from '../review-gates.ts';
import type { PmoDynamicStepHandler } from '../types.ts';
import type { BlockingIssue, DynamicHandlerDeps, StagingChangeSummary } from './common.ts';

export function createPublishAfterApprovalHandler(
  deps: Pick<DynamicHandlerDeps, 'domainAdapter' | 'resolveCardIdentity' | 'readPlannerStepMeta'>,
): PmoDynamicStepHandler {
  return {
    actionId: 'publish_after_approval',
    execute: async (input) => {
      if (!input.runtimeContext.staging_result) {
        throw new Error('v2_staging_result_missing');
      }

      const staging = input.runtimeContext.staging_result;
      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });

      const blockedByGate = shouldBlockPublishApprove({
        changeSummary: staging.changeSummary as StagingChangeSummary,
        hasBlockingIssues: staging.hasBlockingIssues,
      });

      if (!input.resumeData) {
        return {
          kind: 'suspend',
          card: buildPublishReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            changeSummary: staging.changeSummary as StagingChangeSummary,
            blockingIssues: staging.blockingIssues as BlockingIssue[],
            mappingReviewRows: staging.mappingReviewRows,
            allowApprove: !blockedByGate,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmPublish`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_publish_review',
          outputSummary: {
            status: 'needs_review',
          },
        };
      }

      if (input.resumeData.decision === 'reject') {
        return {
          kind: 'rejected',
          sessionStatus: 'rejected',
          outputSummary: {
            status: 'rejected',
            stage: 'publish_after_approval',
          },
          terminalOutput: {
            ingestionSessionId: input.ingestionSessionId,
            status: 'rejected',
            rowsWritten: {},
            rowsUpdated: {},
            rowsSkipped: {},
          },
        };
      }

      if (blockedByGate) {
        return {
          kind: 'suspend',
          card: buildPublishReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            changeSummary: staging.changeSummary as StagingChangeSummary,
            blockingIssues: staging.blockingIssues as BlockingIssue[],
            mappingReviewRows: staging.mappingReviewRows,
            allowApprove: false,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmPublish`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_publish_review',
          outputSummary: {
            status: 'needs_review',
            blocked: true,
          },
        };
      }

      const result = await deps.domainAdapter.publish({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
      });

      return {
        kind: 'completed',
        sessionStatus: 'published',
        outputSummary: {
          status: 'published',
          rows_written: Object.values(result.rowsWritten).reduce((sum, value) => sum + value, 0),
          rows_updated: Object.values(result.rowsUpdated).reduce((sum, value) => sum + value, 0),
          rows_skipped: Object.values(result.rowsSkipped).reduce((sum, value) => sum + value, 0),
        },
        terminalOutput: {
          ingestionSessionId: input.ingestionSessionId,
          status: 'published',
          rowsWritten: result.rowsWritten,
          rowsUpdated: result.rowsUpdated,
          rowsSkipped: result.rowsSkipped,
        },
      };
    },
  };
}
