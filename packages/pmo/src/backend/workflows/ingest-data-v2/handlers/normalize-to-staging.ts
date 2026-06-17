import {
  appendCheckpoint,
  appendProposal,
  approveProposal,
  createProposal,
  getLatestApprovedCheckpoint,
  type IngestionReferenceRule,
  type ReviewAction,
  type ReviewCheckpointState,
} from '@seta/ingestion';
import { eq as drizzleEq } from 'drizzle-orm';
import { pmoDb as getPmoDb } from '../../../db/client.ts';
import { stagingChanges } from '../../../db/schema.ts';
import { normalizeRows } from '../../../ingestion/normalize-rows.ts';
import {
  classifyRows,
  type StagedRow,
  shouldBlockDuplicateInUpload,
} from '../../../ingestion/stage-changes.ts';
import { buildNormalizationReviewCard } from '../cards.ts';
import type { DynamicIngestRuntimeContext, PmoDynamicStepHandler } from '../types.ts';
import type {
  BlockingIssue,
  DetectTableMapping,
  DynamicHandlerDeps,
  MappingResult,
  NormalizationResult,
  StagingChangeSummary,
} from './common.ts';

type StagingResultState = NonNullable<DynamicIngestRuntimeContext['staging_result']>;

function isMissingRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

function normalizeReferenceId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized.toLowerCase() : null;
}

function displayReferenceId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function collectUploadedReferenceIds(
  rows: Array<{ values: Record<string, unknown> }> | undefined,
  field: string,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows ?? []) {
    const id = normalizeReferenceId(row.values[field]);
    if (id) ids.add(id);
  }
  return ids;
}

interface ReferenceLookup {
  rule: IngestionReferenceRule;
  uploadedTargetIds: Set<string>;
  dbTargetIds: Set<string>;
}

function buildStagingPayload(params: {
  normalization: NormalizationResult;
  checkpointState: ReviewCheckpointState;
  requiresReview: boolean;
}): StagingResultState {
  return {
    changeSummary: params.normalization.changeSummary,
    blockingIssues: params.normalization.blockingIssues,
    mappingReviewRows: params.normalization.mappingReviewRows,
    hasBlockingIssues: params.normalization.hasBlockingIssues,
    hasUpdates: params.normalization.hasUpdates,
    requiresReview: params.requiresReview,
    ...(params.checkpointState.review_proposals
      ? { review_proposals: params.checkpointState.review_proposals }
      : {}),
    ...(params.checkpointState.approved_checkpoints
      ? { approved_checkpoints: params.checkpointState.approved_checkpoints }
      : {}),
  };
}

function resolveApprovedMappingResult(
  confirmedMapping:
    | (ReviewCheckpointState & {
        confirmedMappings?: unknown[];
        mappingReviewRows?: Array<{ k: string; v: string }>;
      })
    | undefined,
): MappingResult {
  const checkpoint = getLatestApprovedCheckpoint<MappingResult>(confirmedMapping, 'column_mapping');
  if (checkpoint) {
    return checkpoint.approved_output;
  }

  const hasExplicitProposal = Boolean(confirmedMapping?.review_proposals?.column_mapping?.length);
  if (hasExplicitProposal) {
    throw new Error('approved_checkpoint_missing:column_mapping');
  }

  const legacyConfirmedMappings = confirmedMapping?.confirmedMappings;
  if (Array.isArray(legacyConfirmedMappings) && legacyConfirmedMappings.length > 0) {
    return {
      confirmedMappings: legacyConfirmedMappings as DetectTableMapping[],
      mappingReviewRows: Array.isArray(confirmedMapping?.mappingReviewRows)
        ? confirmedMapping.mappingReviewRows
        : [],
    };
  }

  throw new Error('approved_checkpoint_missing:column_mapping');
}

async function buildReferenceLookups(params: {
  tenantId: string;
  tables: Record<string, Array<{ values: Record<string, unknown> }>>;
  deps: Pick<DynamicHandlerDeps, 'domainConfig' | 'domainAdapter'>;
}): Promise<ReferenceLookup[]> {
  return Promise.all(
    params.deps.domainConfig.referenceRules.map(async (rule) => ({
      rule,
      uploadedTargetIds: collectUploadedReferenceIds(
        params.tables[rule.targetTable],
        rule.targetField,
      ),
      dbTargetIds: await params.deps.domainAdapter.findReferenceValues({
        tenantId: params.tenantId,
        tableId: rule.targetTable,
        fieldName: rule.targetField,
      }),
    })),
  );
}

export function createNormalizeToStagingHandler(
  deps: Pick<
    DynamicHandlerDeps,
    | 'domainConfig'
    | 'domainAdapter'
    | 'resolveCardIdentity'
    | 'readPlannerStepMeta'
    | 'requiredFieldsByTable'
    | 'getWorkbookParseResult'
  >,
): PmoDynamicStepHandler {
  return {
    actionId: 'normalize_to_staging',
    execute: async (input) => {
      if (!input.runtimeContext.confirmed_mapping) {
        throw new Error('approved_checkpoint_missing:column_mapping');
      }

      const confirmed = resolveApprovedMappingResult(input.runtimeContext.confirmed_mapping);
      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });

      const parseResult = await deps.getWorkbookParseResult(input);

      const tableMappings = (confirmed.confirmedMappings as DetectTableMapping[]).map((table) => ({
        ...table,
        mappings: table.mappings.map((mapping) => ({
          ...mapping,
          evidence: '',
          scoringBreakdown: {
            headerSimilarity: 0,
            valuePattern: 0,
            dataType: 0,
            sheetContext: 0,
            crossSheet: 0,
            llmSemantic: 0,
          },
        })),
      }));

      const normResult = normalizeRows(
        parseResult.sheets,
        tableMappings as never,
        deps.domainConfig,
      );
      const referenceLookups = await buildReferenceLookups({
        tenantId: input.tenantId,
        tables: normResult.tables,
        deps,
      });

      const blockingIssueMap = new Map<string, BlockingIssue>();
      const addBlockingIssue = (issue: BlockingIssue): void => {
        const key = `${issue.tableId}|${issue.sourceRow}|${issue.field}|${issue.reason}`;
        if (blockingIssueMap.has(key)) return;
        if (blockingIssueMap.size >= 200) return;
        blockingIssueMap.set(key, issue);
      };

      const allStaged: StagedRow[] = [];
      const rowCountsByTable: Record<string, number> = {};
      const duplicateInUploadRows: NormalizationResult['duplicateInUploadRows'] = [];
      const changeSummary: Array<{
        tableId: string;
        counts: {
          new_records: number;
          updated_records: number;
          exact_duplicates: number;
          duplicates_in_upload: number;
        };
        sampleChanges: Array<{
          type: string;
          naturalKey: Record<string, string>;
          newValues: Record<string, unknown>;
        }>;
      }> = [];

      for (const [tableId, rows] of Object.entries(normResult.tables)) {
        rowCountsByTable[tableId] = rows.length;
        const requiredFields = deps.requiredFieldsByTable.get(tableId) ?? [];
        for (const row of rows) {
          for (const parseError of row.parseErrors) {
            addBlockingIssue({
              tableId,
              sourceRow: row.sourceRow,
              field: parseError.field,
              reason: parseError.error,
            });
          }
          for (const field of requiredFields) {
            if (!isMissingRequiredValue(row.values[field])) continue;
            addBlockingIssue({
              tableId,
              sourceRow: row.sourceRow,
              field,
              reason: 'required value missing after normalization',
            });
          }

          for (const lookup of referenceLookups) {
            const { rule } = lookup;
            if (rule.sourceTable !== tableId) continue;
            if (!rule.blocking) continue;
            if (isMissingRequiredValue(row.values[rule.sourceField])) continue;

            const id = normalizeReferenceId(row.values[rule.sourceField]);
            if (!id) continue;
            if (lookup.uploadedTargetIds.has(id) || lookup.dbTargetIds.has(id)) continue;
            addBlockingIssue({
              tableId,
              sourceRow: row.sourceRow,
              field: rule.sourceField,
              reason:
                `unresolved reference: ${rule.sourceField} "${displayReferenceId(row.values[rule.sourceField])}" ` +
                `not found in uploaded ${rule.targetTable}.${rule.targetField} ` +
                `or database ${rule.targetTable}.${rule.targetField}`,
            });
          }
        }

        const activeRecords = await deps.domainAdapter.findActiveRecords({
          tenantId: input.tenantId,
          tableId,
        });
        const staged = classifyRows(
          tableId,
          input.tenantId,
          rows,
          activeRecords,
          deps.domainConfig,
        );
        allStaged.push(...staged);
        for (const stagedRow of staged) {
          if (stagedRow.changeType !== 'duplicate_in_upload') continue;
          duplicateInUploadRows.push({
            tableId,
            naturalKey: stagedRow.naturalKeyDisplay,
            sourceRow: stagedRow.sourceRow,
            policy: shouldBlockDuplicateInUpload(tableId, deps.domainConfig) ? 'block' : 'skip',
          });
        }

        const counts = {
          new_records: 0,
          updated_records: 0,
          exact_duplicates: 0,
          duplicates_in_upload: 0,
        };
        for (const stagedRow of staged) {
          if (stagedRow.changeType === 'new_record') counts.new_records++;
          if (stagedRow.changeType === 'updated_record') counts.updated_records++;
          if (stagedRow.changeType === 'exact_duplicate') counts.exact_duplicates++;
          if (stagedRow.changeType === 'duplicate_in_upload') counts.duplicates_in_upload++;
        }

        const sampleChanges = staged
          .filter((entry) => entry.changeType !== 'exact_duplicate')
          .slice(0, 5)
          .map((entry) => ({
            type: entry.changeType as 'new_record' | 'updated_record' | 'duplicate_in_upload',
            naturalKey: entry.naturalKeyDisplay,
            newValues: entry.values,
          }));

        changeSummary.push({
          tableId,
          counts,
          sampleChanges,
        });
      }

      const blockingIssues = [...blockingIssueMap.values()];
      const hasBlockingIssues = blockingIssues.length > 0;
      const hasUpdates = changeSummary.some(
        (table) => table.counts.new_records + table.counts.updated_records > 0,
      );
      const hasBlockingDuplicates = duplicateInUploadRows.some((row) => row.policy === 'block');
      const blocked = hasBlockingIssues || hasBlockingDuplicates;
      const normalizationResult: NormalizationResult = {
        changeSummary: changeSummary as StagingChangeSummary,
        blockingIssues,
        mappingReviewRows: confirmed.mappingReviewRows,
        hasBlockingIssues,
        hasUpdates,
        requiresReview: true,
        rowCountsByTable,
        duplicateInUploadRows,
      };
      const nextAllowedActions: ReviewAction[] = blocked
        ? ['reject', 'rerun']
        : ['approve', 'reject', 'rerun'];
      const proposal =
        input.runtimeContext.staging_result?.review_proposals?.normalize_to_staging?.at(-1) ??
        createProposal({
          state: input.runtimeContext.staging_result ?? {},
          stepId: 'normalize_to_staging',
          proposal: normalizationResult,
          status: 'needs_review',
          reviewRequired: true,
          nextAllowedActions,
          createdBy: 'agent',
          metadata: {
            blocked,
            blocking_issue_count: blockingIssues.length,
            duplicate_in_upload_count: duplicateInUploadRows.length,
          },
        });
      const proposedState = input.runtimeContext.staging_result?.review_proposals
        ?.normalize_to_staging?.length
        ? (input.runtimeContext.staging_result as ReviewCheckpointState)
        : appendProposal(input.runtimeContext.staging_result ?? {}, proposal);
      const proposedStagingPayload = buildStagingPayload({
        normalization: normalizationResult,
        checkpointState: proposedState,
        requiresReview: true,
      });

      if (!input.resumeData) {
        return {
          kind: 'suspend',
          card: buildNormalizationReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            changeSummary: changeSummary as StagingChangeSummary,
            blockingIssues,
            allowApprove: !blocked,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_reviewNormalization`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_normalization_review',
          runtimeContextPatch: {
            staging_result: proposedStagingPayload,
          },
          outputSummary: {
            status: 'needs_review',
            blocking_issues: blockingIssues.length,
          },
        };
      }

      if (input.resumeData.decision === 'reject') {
        return {
          kind: 'rejected',
          sessionStatus: 'rejected',
          outputSummary: {
            status: 'rejected',
            stage: 'normalization',
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

      if (blocked) {
        return {
          kind: 'suspend',
          card: buildNormalizationReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            changeSummary: changeSummary as StagingChangeSummary,
            blockingIssues,
            allowApprove: false,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_reviewNormalization`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_normalization_review',
          runtimeContextPatch: {
            staging_result: proposedStagingPayload,
          },
          outputSummary: {
            status: 'needs_review',
            blocking_issues: blockingIssues.length,
          },
        };
      }

      const checkpoint = approveProposal({
        proposal,
        approvedOutput: normalizationResult,
        approvedBy: input.userId || 'system',
      });
      const approvedState = appendCheckpoint(proposedState, checkpoint);
      const approvedStagingPayload = buildStagingPayload({
        normalization: normalizationResult,
        checkpointState: approvedState,
        requiresReview: false,
      });

      const db = getPmoDb();
      await db
        .delete(stagingChanges)
        .where(drizzleEq(stagingChanges.ingestion_session_id, input.ingestionSessionId));

      if (allStaged.length > 0) {
        await db.insert(stagingChanges).values(
          allStaged.map((entry) => ({
            ingestion_session_id: input.ingestionSessionId,
            table_id: entry.tableId,
            natural_key_hash: entry.naturalKeyHash,
            change_type: entry.changeType,
            new_values: entry.values,
            natural_key_display: entry.naturalKeyDisplay,
            old_values: entry.oldValues ?? null,
          })),
        );
      }

      return {
        kind: 'completed',
        sessionStatus: 'staging_normalized',
        runtimeContextPatch: {
          staging_result: approvedStagingPayload,
        },
        sessionPatch: {
          change_summary: approvedStagingPayload,
        },
        outputSummary: {
          status: 'staging_normalized',
          change_tables: changeSummary.length,
          checkpoint_version: checkpoint.version,
        },
      };
    },
  };
}
