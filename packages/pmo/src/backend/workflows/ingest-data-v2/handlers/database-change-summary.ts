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
  NormalizationResult,
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

function assertApprovedNormalizationCheckpoint(staging: StagingResultState): void {
  const latestProposal = getLatestProposal<NormalizationResult>(staging, 'normalize_to_staging');
  if (!latestProposal) {
    return;
  }

  const latestCheckpoint = getLatestApprovedCheckpoint<NormalizationResult>(
    staging,
    'normalize_to_staging',
  );
  if (!latestCheckpoint) {
    throw new Error('approved_checkpoint_missing:normalize_to_staging');
  }
  if (latestCheckpoint.version < latestProposal.version) {
    throw new Error('approved_checkpoint_superseded:normalize_to_staging');
  }
  if (latestCheckpoint.approved_output.hasBlockingIssues) {
    throw new Error('approved_checkpoint_blocked:normalize_to_staging');
  }
}

export function createDatabaseChangeSummaryHandler(
  deps: Pick<DynamicHandlerDeps, 'domainAdapter' | 'resolveCardIdentity' | 'readPlannerStepMeta'>,
): PmoDynamicStepHandler {
  return {
    actionId: 'database_change_summary',
    execute: async (input) => {
      if (!input.runtimeContext.staging_result) {
        throw new Error('v2_staging_result_missing');
      }

      const staging = input.runtimeContext.staging_result;
      assertApprovedNormalizationCheckpoint(staging);

      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });

      const blockedByGate = shouldBlockPublishApprove({
        changeSummary: staging.changeSummary as StagingChangeSummary,
        hasBlockingIssues: staging.hasBlockingIssues,
      });
      const dbChangeResult = buildDbChangeSummaryResult(staging);
      const proposal =
        input.runtimeContext.staging_result?.review_proposals?.database_change_summary?.at(-1) ??
        createProposal({
          state: staging,
          stepId: 'database_change_summary',
          proposal: dbChangeResult,
          status: 'needs_review',
          reviewRequired: true,
          nextAllowedActions: blockedByGate ? ['reject', 'rerun'] : ['approve', 'reject', 'rerun'],
          createdBy: 'agent',
          metadata: {
            blocked: blockedByGate,
          },
        });
      const proposedState = input.runtimeContext.staging_result?.review_proposals
        ?.database_change_summary?.length
        ? staging
        : appendProposal(staging, proposal);
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
            blocked: blockedByGate,
          },
        };
      }

      if (input.resumeData.decision === 'reject') {
        return {
          kind: 'rejected',
          sessionStatus: 'rejected',
          outputSummary: {
            status: 'rejected',
            stage: 'database_change_summary',
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
      const publishResult = await deps.domainAdapter.publish({
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
          checkpoint_version: checkpoint.version,
          rows_written: Object.values(publishResult.rowsWritten).reduce(
            (sum, value) => sum + value,
            0,
          ),
          rows_updated: Object.values(publishResult.rowsUpdated).reduce(
            (sum, value) => sum + value,
            0,
          ),
          rows_skipped: Object.values(publishResult.rowsSkipped).reduce(
            (sum, value) => sum + value,
            0,
          ),
        },
        terminalOutput: {
          ingestionSessionId: input.ingestionSessionId,
          status: 'published',
          rowsWritten: publishResult.rowsWritten,
          rowsUpdated: publishResult.rowsUpdated,
          rowsSkipped: publishResult.rowsSkipped,
        },
      };
    },
  };
}
