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
import type { PmoDynamicStepHandler } from '../types.ts';
import type {
  BlockingIssue,
  DetectTableMapping,
  DynamicHandlerDeps,
  StagingChangeSummary,
} from './common.ts';

function isMissingRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

export function createNormalizeToStagingHandler(
  deps: Pick<
    DynamicHandlerDeps,
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
        throw new Error('v2_confirmed_mapping_missing');
      }

      const confirmed = input.runtimeContext.confirmed_mapping;
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

      const normResult = normalizeRows(parseResult.sheets, tableMappings as never);

      const blockingIssueMap = new Map<string, BlockingIssue>();
      const addBlockingIssue = (issue: BlockingIssue): void => {
        const key = `${issue.tableId}|${issue.sourceRow}|${issue.field}|${issue.reason}`;
        if (blockingIssueMap.has(key)) return;
        if (blockingIssueMap.size >= 200) return;
        blockingIssueMap.set(key, issue);
      };

      const allStaged: StagedRow[] = [];
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
        }

        const staged = classifyRows(tableId, input.tenantId, rows, []);
        allStaged.push(...staged);

        const counts = {
          new_records: 0,
          updated_records: 0,
          exact_duplicates: 0,
          duplicates_in_upload: 0,
        };
        for (const stagedRow of staged) {
          counts[`${stagedRow.changeType}s` as keyof typeof counts]++;
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
      const hasBlockingDuplicates = changeSummary.some(
        (table) =>
          table.counts.duplicates_in_upload > 0 && shouldBlockDuplicateInUpload(table.tableId),
      );
      const blocked = hasBlockingIssues || hasBlockingDuplicates;

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
            staging_result: {
              changeSummary,
              blockingIssues,
              mappingReviewRows: confirmed.mappingReviewRows,
              hasBlockingIssues,
              hasUpdates,
              requiresReview: true,
            },
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
            staging_result: {
              changeSummary,
              blockingIssues,
              mappingReviewRows: confirmed.mappingReviewRows,
              hasBlockingIssues,
              hasUpdates,
              requiresReview: true,
            },
          },
          outputSummary: {
            status: 'needs_review',
            blocking_issues: blockingIssues.length,
          },
        };
      }

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
          staging_result: {
            changeSummary,
            blockingIssues,
            mappingReviewRows: confirmed.mappingReviewRows,
            hasBlockingIssues,
            hasUpdates,
            requiresReview: false,
          },
        },
        sessionPatch: {
          change_summary: {
            changeSummary,
            blockingIssues,
            mappingReviewRows: confirmed.mappingReviewRows,
            hasBlockingIssues,
            hasUpdates,
            requiresReview: false,
          },
        },
        outputSummary: {
          status: 'staging_normalized',
          change_tables: changeSummary.length,
        },
      };
    },
  };
}
