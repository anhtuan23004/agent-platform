import {
  appendCheckpoint,
  appendProposal,
  approveProposal,
  createProposal,
  getLatestApprovedCheckpoint,
  getLatestProposal,
  type ReviewCheckpointState,
} from '@seta/ingestion';
import { buildPublishReviewCard } from '../cards.ts';
import { shouldBlockPublishApprove } from '../review-gates.ts';
import type { DynamicIngestRuntimeContext, PmoDynamicStepHandler } from '../types.ts';
import type {
  BlockingIssue,
  DbChangeSummaryResult,
  DynamicHandlerDeps,
  StagingChangeSummary,
} from './common.ts';

type StagingResultState = NonNullable<DynamicIngestRuntimeContext['staging_result']>;

function buildDbChangeSummaryResult(staging: StagingResultState): DbChangeSummaryResult {
  return {
    changeSummary: staging.changeSummary as StagingChangeSummary,
    blockingIssues: staging.blockingIssues as BlockingIssue[],
    mappingReviewRows: staging.mappingReviewRows,
    hasBlockingIssues: staging.hasBlockingIssues,
    hasUpdates: staging.hasUpdates,
    requiresReview: true,
  };
}

function buildStagingPayload(params: {
  staging: StagingResultState;
  checkpointState: ReviewCheckpointState;
}): StagingResultState {
  return {
    ...params.staging,
    ...(params.checkpointState.review_proposals
      ? { review_proposals: params.checkpointState.review_proposals }
      : {}),
    ...(params.checkpointState.approved_checkpoints
      ? { approved_checkpoints: params.checkpointState.approved_checkpoints }
      : {}),
  };
}

function assertApprovedDbChangeCheckpointIsCurrent(staging: StagingResultState): void {
  const latestProposal = getLatestProposal<DbChangeSummaryResult>(
    staging,
    'database_change_summary',
  );
  const latestCheckpoint = getLatestApprovedCheckpoint<DbChangeSummaryResult>(
    staging,
    'database_change_summary',
  );

  if (!latestCheckpoint) {
    throw new Error('approved_checkpoint_missing:database_change_summary');
  }
  if (latestProposal && latestCheckpoint.version < latestProposal.version) {
    throw new Error('approved_checkpoint_superseded:database_change_summary');
  }
  if (
    latestCheckpoint.approved_output.hasBlockingIssues ||
    shouldBlockPublishApprove({
      changeSummary: latestCheckpoint.approved_output.changeSummary,
      hasBlockingIssues: latestCheckpoint.approved_output.hasBlockingIssues,
    })
  ) {
    throw new Error('approved_checkpoint_blocked:database_change_summary');
  }
}

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
      const latestCheckpoint = getLatestApprovedCheckpoint<DbChangeSummaryResult>(
        staging,
        'database_change_summary',
      );
      const latestProposal = getLatestProposal<DbChangeSummaryResult>(
        staging,
        'database_change_summary',
      );

      if (
        latestCheckpoint &&
        (!latestProposal || latestCheckpoint.version >= latestProposal.version)
      ) {
        assertApprovedDbChangeCheckpointIsCurrent(staging);
        const result = await deps.domainAdapter.publish({
          ingestionSessionId: input.ingestionSessionId,
          tenantId: input.tenantId,
        });

        return {
          kind: 'completed',
          sessionStatus: 'published',
          outputSummary: {
            status: 'published',
            db_change_checkpoint_version: latestCheckpoint.version,
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
      }

      if (latestProposal && !input.resumeData) {
        throw new Error('approved_checkpoint_missing:database_change_summary');
      }

      const dbChangeResult = buildDbChangeSummaryResult(staging);
      const proposal =
        latestProposal ??
        createProposal({
          state: staging,
          stepId: 'database_change_summary',
          proposal: dbChangeResult,
          status: 'needs_review',
          reviewRequired: true,
          nextAllowedActions: blockedByGate ? ['reject', 'rerun'] : ['approve', 'reject', 'rerun'],
          createdBy: 'agent',
          metadata: {
            created_by_step: 'publish_after_approval',
            blocked: blockedByGate,
          },
        });
      const proposedState = latestProposal ? staging : appendProposal(staging, proposal);
      const proposedPayload = buildStagingPayload({
        staging,
        checkpointState: proposedState,
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
          runtimeContextPatch: {
            staging_result: proposedPayload,
          },
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
          runtimeContextPatch: {
            staging_result: proposedPayload,
          },
          outputSummary: {
            status: 'needs_review',
            blocked: true,
          },
        };
      }

      const checkpoint = approveProposal({
        proposal,
        approvedOutput: dbChangeResult,
        approvedBy: input.userId || 'system',
      });
      const approvedState = appendCheckpoint(proposedState, checkpoint);
      const approvedPayload = buildStagingPayload({
        staging,
        checkpointState: approvedState,
      });

      const result = await deps.domainAdapter.publish({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
      });

      return {
        kind: 'completed',
        sessionStatus: 'published',
        runtimeContextPatch: {
          staging_result: approvedPayload,
        },
        sessionPatch: {
          change_summary: approvedPayload,
        },
        outputSummary: {
          status: 'published',
          db_change_checkpoint_version: checkpoint.version,
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
