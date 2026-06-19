import {
  appendCheckpoint,
  appendProposal,
  approveProposal,
  createProposal,
  getLatestApprovedCheckpoint,
  getLatestProposal,
  type ReviewCheckpointState,
} from '@seta/ingestion';
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../../../db/client.ts';
import { stagingChanges } from '../../../db/schema.ts';
import { computeSourceRowHash } from '../../../ingestion/stage-changes.ts';
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

/**
 * Reclassify staging_changes rows by comparing with canonical DB active records.
 * Updates change_type from the normalize step's provisional `new_record` to the
 * correct `new_record` / `updated_record` / `exact_duplicate` based on DB state.
 * Returns the reclassified change summary per table.
 */
async function reclassifyStagingChanges(
  ingestionSessionId: string,
  tenantId: string,
  deps: Pick<DynamicHandlerDeps, 'domainAdapter' | 'domainConfig'>,
): Promise<StagingChangeSummary> {
  const db = pmoDb();
  const rows = await db
    .select({
      id: stagingChanges.id,
      table_id: stagingChanges.table_id,
      natural_key_hash: stagingChanges.natural_key_hash,
      new_values: stagingChanges.new_values,
      change_type: stagingChanges.change_type,
    })
    .from(stagingChanges)
    .where(eq(stagingChanges.ingestion_session_id, ingestionSessionId));

  // Group by table_id
  const byTable = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byTable.get(row.table_id) ?? [];
    list.push(row);
    byTable.set(row.table_id, list);
  }

  type ChangeSummaryTable = StagingChangeSummary[number];
  const summary: ChangeSummaryTable[] = [];

  for (const [tableId, tableRows] of byTable) {
    const activeRecords = await deps.domainAdapter.findActiveRecords({ tenantId, tableId });
    const activeMap = new Map<string, string>();
    for (const rec of activeRecords) {
      activeMap.set(rec.natural_key_hash, rec.source_row_hash);
    }

    const counts = {
      new_records: 0,
      updated_records: 0,
      exact_duplicates: 0,
      duplicates_in_upload: 0,
    };
    const sampleChanges: ChangeSummaryTable['sampleChanges'] = [];

    for (const row of tableRows) {
      const values = (row.new_values ?? {}) as Record<string, unknown>;
      const existingHash = activeMap.get(row.natural_key_hash);
      let resolvedType: string;

      if (existingHash === undefined) {
        resolvedType = 'new_record';
        counts.new_records++;
      } else {
        const sourceHash = computeSourceRowHash(tableId, values, deps.domainConfig);
        if (sourceHash === existingHash) {
          resolvedType = 'exact_duplicate';
          counts.exact_duplicates++;
        } else {
          resolvedType = 'updated_record';
          counts.updated_records++;
        }
      }

      if (resolvedType !== row.change_type) {
        await db
          .update(stagingChanges)
          .set({ change_type: resolvedType })
          .where(and(eq(stagingChanges.id, row.id)));
      }

      if (resolvedType !== 'exact_duplicate' && sampleChanges.length < 5) {
        const display = (row as { natural_key_display?: unknown }).natural_key_display;
        sampleChanges.push({
          type: resolvedType as 'new_record' | 'updated_record',
          naturalKey: (display && typeof display === 'object' ? display : {}) as Record<
            string,
            string
          >,
          newValues: values,
        });
      }
    }

    summary.push({ tableId, counts, sampleChanges });
  }

  return summary;
}

export function createDatabaseChangeSummaryHandler(
  deps: Pick<
    DynamicHandlerDeps,
    'domainAdapter' | 'domainConfig' | 'resolveCardIdentity' | 'readPlannerStepMeta'
  >,
): PmoDynamicStepHandler {
  return {
    actionId: 'database_change_summary',
    execute: async (input) => {
      const writePolicy =
        input.planningPlan && typeof input.planningPlan === 'object'
          ? (input.planningPlan as { intent_analysis?: { writePolicy?: unknown } }).intent_analysis
              ?.writePolicy
          : undefined;
      const willPublish = writePolicy === 'requires_approval';
      if (!input.runtimeContext.staging_result) {
        throw new Error('v2_staging_result_missing');
      }

      const staging = input.runtimeContext.staging_result;
      assertApprovedNormalizationCheckpoint(staging);

      // Reclassify staging rows against canonical DB to determine
      // new_record / updated_record / exact_duplicate.
      const reclassifiedSummary = await reclassifyStagingChanges(
        input.ingestionSessionId,
        input.tenantId,
        deps,
      );
      const hasUpdates = reclassifiedSummary.some(
        (table) => table.counts.new_records + table.counts.updated_records > 0,
      );

      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });

      // Enrich staging with reclassified change summary from DB comparison.
      const enrichedStaging: StagingResultState = {
        ...staging,
        changeSummary: reclassifiedSummary,
        hasUpdates,
      };

      const blockedByGate = shouldBlockPublishApprove({
        changeSummary: reclassifiedSummary,
        hasBlockingIssues: enrichedStaging.hasBlockingIssues,
      });
      const dbChangeResult = buildDbChangeSummaryResult(enrichedStaging);
      const proposal =
        input.runtimeContext.staging_result?.review_proposals?.database_change_summary?.at(-1) ??
        createProposal({
          state: enrichedStaging,
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
        ? enrichedStaging
        : appendProposal(enrichedStaging, proposal);
      const proposedPayload = buildStagingPayload({
        staging: enrichedStaging,
        checkpointState: proposedState,
      });

      if (!input.resumeData) {
        return {
          kind: 'suspend',
          card: buildPublishReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            changeSummary: reclassifiedSummary,
            blockingIssues: enrichedStaging.blockingIssues as BlockingIssue[],
            mappingReviewRows: enrichedStaging.mappingReviewRows,
            allowApprove: !blockedByGate,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmPublish`,
            plannerStep,
            willPublish,
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
            changeSummary: reclassifiedSummary,
            blockingIssues: enrichedStaging.blockingIssues as BlockingIssue[],
            mappingReviewRows: enrichedStaging.mappingReviewRows,
            allowApprove: false,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmPublish`,
            plannerStep,
            willPublish,
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
        staging: enrichedStaging,
        checkpointState: approvedState,
      });
      return {
        kind: 'completed',
        sessionStatus: 'reviewed',
        runtimeContextPatch: {
          staging_result: approvedPayload,
        },
        sessionPatch: {
          change_summary: approvedPayload,
        },
        outputSummary: {
          status: 'reviewed',
          checkpoint_version: checkpoint.version,
        },
        terminalOutput: {
          ingestionSessionId: input.ingestionSessionId,
          status: 'completed',
          rowsWritten: {},
          rowsUpdated: {},
          rowsSkipped: {},
        },
      };
    },
  };
}
