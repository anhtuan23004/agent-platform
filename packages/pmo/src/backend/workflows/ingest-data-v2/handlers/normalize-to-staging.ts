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
import {
  type NormalizedRow,
  normalizeRawFieldValue,
  normalizeRows,
} from '../../../ingestion/normalize-rows.ts';
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
  NormalizationReviewColumn,
  NormalizationReviewRow,
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

interface TableReviewContext {
  tableId: string;
  sourceSheet: string;
  headerRow: number;
  columns: NormalizationReviewColumn[];
  sourceColumnByField: Map<string, string>;
  rawRowBySourceRow: Map<number, Record<string, unknown>>;
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

function buildTableReviewContexts(params: {
  tableMappings: DetectTableMapping[];
  sheets: Awaited<ReturnType<DynamicHandlerDeps['getWorkbookParseResult']>>['sheets'];
}): Map<string, TableReviewContext> {
  const sheetByName = new Map(params.sheets.map((sheet) => [sheet.name, sheet]));
  const contexts = new Map<string, TableReviewContext>();

  for (const mapping of params.tableMappings) {
    const sourceColumnByField = new Map<string, string>();
    const columns: NormalizationReviewColumn[] = [];
    for (const columnMapping of mapping.mappings) {
      sourceColumnByField.set(columnMapping.canonicalField, columnMapping.sourceColumn);
      columns.push({
        key: columnMapping.sourceColumn,
        label: columnMapping.sourceColumn,
      });
    }

    const rawRowBySourceRow = new Map<number, Record<string, unknown>>();
    const sheet = sheetByName.get(mapping.sourceSheet);
    for (const [rowIndex, row] of (sheet?.rows ?? []).entries()) {
      rawRowBySourceRow.set(mapping.headerRow + rowIndex + 1, row);
    }

    contexts.set(tableReviewContextKey(mapping.tableId, mapping.sourceSheet), {
      tableId: mapping.tableId,
      sourceSheet: mapping.sourceSheet,
      headerRow: mapping.headerRow,
      columns,
      sourceColumnByField,
      rawRowBySourceRow,
    });
  }

  return contexts;
}

function tableReviewContextKey(tableId: string, sourceSheet: string | undefined): string {
  return `${tableId}:${sourceSheet ?? ''}`;
}

function getReviewContext(
  contexts: Map<string, TableReviewContext>,
  tableId: string,
  sourceSheet: string | undefined,
): TableReviewContext | undefined {
  return (
    contexts.get(tableReviewContextKey(tableId, sourceSheet)) ??
    [...contexts.values()].find((context) => context.tableId === tableId)
  );
}

function valueRecordForReviewRow(
  context: TableReviewContext | undefined,
  sourceRow: number,
  normalizedValues: Record<string, unknown>,
): Record<string, unknown> {
  if (!context) return normalizedValues;
  const raw = context.rawRowBySourceRow.get(sourceRow);
  if (raw) return raw;

  const values: Record<string, unknown> = {};
  for (const [field, sourceColumn] of context.sourceColumnByField.entries()) {
    values[sourceColumn] = normalizedValues[field];
  }
  return values;
}

function reviewValuesForRow(params: {
  context: TableReviewContext | undefined;
  sourceRow: number;
  normalizedValues: Record<string, unknown>;
  rowId: string;
  rowOverrides: Map<string, Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    ...valueRecordForReviewRow(params.context, params.sourceRow, params.normalizedValues),
    ...(params.rowOverrides.get(params.rowId) ?? {}),
  };
}

function readRowDecisions(
  resumeData: Record<string, unknown> | undefined,
): Map<string, 'keep_row' | 'skip_row'> {
  const decisions = new Map<string, 'keep_row' | 'skip_row'>();
  const raw = resumeData?.rowDecisions;
  if (!Array.isArray(raw)) return decisions;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rowId = (item as { rowId?: unknown }).rowId;
    const decision = (item as { decision?: unknown }).decision;
    if (typeof rowId !== 'string') continue;
    if (decision !== 'keep_row' && decision !== 'skip_row') continue;
    decisions.set(rowId, decision);
  }

  return decisions;
}

function readRowOverrides(
  resumeData: Record<string, unknown> | undefined,
): Map<string, Record<string, unknown>> {
  const overrides = new Map<string, Record<string, unknown>>();
  const raw = resumeData?.rowOverrides;
  if (!Array.isArray(raw)) return overrides;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rowId = (item as { rowId?: unknown }).rowId;
    const values = (item as { values?: unknown }).values;
    if (typeof rowId !== 'string') continue;
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    overrides.set(rowId, values as Record<string, unknown>);
  }

  return overrides;
}

function applyRowOverrides(params: {
  rows: NormalizedRow[];
  tableId: string;
  reviewContexts: Map<string, TableReviewContext>;
  overrides: Map<string, Record<string, unknown>>;
  domainConfig: DynamicHandlerDeps['domainConfig'];
}): NormalizedRow[] {
  if (params.overrides.size === 0) return params.rows;

  return params.rows.map((row) => {
    const rowId = reviewRowId(params.tableId, row.sourceRow, row.sourceSheet);
    const override = params.overrides.get(rowId);
    if (!override) return row;

    const context = getReviewContext(params.reviewContexts, params.tableId, row.sourceSheet);
    const values = { ...row.values };
    const parseErrors = row.parseErrors.filter((error) => {
      const sourceColumn = context?.sourceColumnByField.get(error.field) ?? error.field;
      return !(sourceColumn in override || error.field in override);
    });

    for (const [field, sourceColumn] of context?.sourceColumnByField.entries() ?? []) {
      if (!(sourceColumn in override) && !(field in override)) continue;
      const rawValue = sourceColumn in override ? override[sourceColumn] : override[field];
      const parsed = normalizeRawFieldValue(params.domainConfig, params.tableId, field, rawValue);
      values[field] = parsed.value;
      if (parsed.error) {
        parseErrors.push({
          field,
          raw: rawValue === undefined ? '' : String(rawValue),
          error: parsed.error,
        });
      }
    }

    return {
      ...row,
      values,
      parseErrors,
    };
  });
}

function problemColumns(context: TableReviewContext | undefined, fields: string[]): string[] {
  if (!context) return fields;
  return fields.map((field) => context.sourceColumnByField.get(field) ?? field);
}

function reviewRowId(tableId: string, sourceRow: number, sourceSheet?: string): string {
  return `${tableId}:${sourceSheet ?? 'sheet'}:${sourceRow}`;
}

function reviewRowLabel(sourceRow: number, sourceSheet?: string): string {
  return sourceSheet ? `${sourceSheet} row ${sourceRow}` : `row ${sourceRow}`;
}

function issueTypeForBlockingReason(reason: string): NormalizationReviewRow['issueType'] {
  if (reason.includes('unresolved reference')) return 'missing_reference';
  if (reason.includes('required value missing')) return 'missing_required';
  return 'parse_error';
}

function issueLabelForType(type: NormalizationReviewRow['issueType']): string {
  if (type === 'duplicate_in_upload') return 'Duplicate';
  if (type === 'missing_reference') return 'Missing reference';
  if (type === 'missing_required') return 'Missing field';
  if (type === 'exact_duplicate') return 'Skipped';
  return 'Blocked';
}

function groupLabelForType(type: NormalizationReviewRow['issueType']): string {
  if (type === 'duplicate_in_upload') return 'Duplicates';
  if (type === 'missing_reference') return 'Missing references';
  if (type === 'missing_required') return 'Missing fields';
  if (type === 'exact_duplicate') return 'Rows to skip';
  return 'Parse errors';
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
      const reviewContexts = buildTableReviewContexts({
        tableMappings: tableMappings as DetectTableMapping[],
        sheets: parseResult.sheets,
      });

      const normResult = normalizeRows(
        parseResult.sheets,
        tableMappings as never,
        deps.domainConfig,
      );
      const rowDecisions = readRowDecisions(input.resumeData);
      const rowOverrides = readRowOverrides(input.resumeData);
      const normalizedTables = Object.fromEntries(
        Object.entries(normResult.tables).map(([tableId, rows]) => [
          tableId,
          applyRowOverrides({
            rows,
            tableId,
            reviewContexts,
            overrides: rowOverrides,
            domainConfig: deps.domainConfig,
          }),
        ]),
      ) as Record<string, NormalizedRow[]>;
      const referenceLookups = await buildReferenceLookups({
        tenantId: input.tenantId,
        tables: normalizedTables,
        deps,
      });

      const blockingIssueMap = new Map<string, BlockingIssue>();
      const addBlockingIssue = (issue: BlockingIssue): void => {
        const key = `${issue.tableId}|${issue.sourceSheet ?? ''}|${issue.sourceRow}|${issue.field}|${issue.reason}`;
        if (blockingIssueMap.has(key)) return;
        if (blockingIssueMap.size >= 200) return;
        blockingIssueMap.set(key, issue);
      };

      const allStaged: StagedRow[] = [];
      const rowCountsByTable: Record<string, number> = {};
      const duplicateInUploadRows: NormalizationResult['duplicateInUploadRows'] = [];
      const reviewRows: NormalizationReviewRow[] = [];
      const reviewRowKeys = new Set<string>();
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

      for (const [tableId, rows] of Object.entries(normalizedTables)) {
        rowCountsByTable[tableId] = rows.length;
        const requiredFields = deps.requiredFieldsByTable.get(tableId) ?? [];
        for (const row of rows) {
          const rowId = reviewRowId(tableId, row.sourceRow, row.sourceSheet);
          if (rowDecisions.get(rowId) === 'skip_row') continue;

          for (const parseError of row.parseErrors) {
            addBlockingIssue({
              tableId,
              sourceSheet: row.sourceSheet,
              sourceRow: row.sourceRow,
              field: parseError.field,
              reason: parseError.error,
            });
          }
          for (const field of requiredFields) {
            if (!isMissingRequiredValue(row.values[field])) continue;
            addBlockingIssue({
              tableId,
              sourceSheet: row.sourceSheet,
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
              sourceSheet: row.sourceSheet,
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
        const firstRowByNaturalKey = new Map<string, StagedRow>();
        for (const stagedRow of staged) {
          if (!firstRowByNaturalKey.has(stagedRow.naturalKeyHash)) {
            firstRowByNaturalKey.set(stagedRow.naturalKeyHash, stagedRow);
          }
        }
        for (const stagedRow of staged) {
          if (stagedRow.changeType !== 'duplicate_in_upload') continue;
          const firstRow = firstRowByNaturalKey.get(stagedRow.naturalKeyHash);
          const duplicateGroupKey = `${tableId}:${stagedRow.naturalKeyHash}`;
          const firstRowId = firstRow
            ? reviewRowId(tableId, firstRow.sourceRow, firstRow.sourceSheet)
            : undefined;
          duplicateInUploadRows.push({
            tableId,
            ...(stagedRow.sourceSheet ? { sourceSheet: stagedRow.sourceSheet } : {}),
            rowId: reviewRowId(tableId, stagedRow.sourceRow, stagedRow.sourceSheet),
            duplicateGroupKey,
            naturalKey: stagedRow.naturalKeyDisplay,
            sourceRow: stagedRow.sourceRow,
            policy: shouldBlockDuplicateInUpload(tableId, deps.domainConfig) ? 'block' : 'skip',
          });
          for (const rowForReview of [firstRow, stagedRow]) {
            if (!rowForReview) continue;
            const context = getReviewContext(reviewContexts, tableId, rowForReview.sourceSheet);
            const isFirstDuplicateRow = rowForReview === firstRow;
            const rowId = reviewRowId(tableId, rowForReview.sourceRow, rowForReview.sourceSheet);
            const key = `${reviewRowId(
              tableId,
              rowForReview.sourceRow,
              rowForReview.sourceSheet,
            )}:duplicate_in_upload`;
            if (reviewRowKeys.has(key)) continue;
            reviewRowKeys.add(key);
            reviewRows.push({
              id: rowId,
              groupId: duplicateGroupKey,
              groupLabel: 'Duplicates',
              tableId,
              ...(rowForReview.sourceSheet ? { sourceSheet: rowForReview.sourceSheet } : {}),
              sourceRow: rowForReview.sourceRow,
              status: 'duplicate',
              issueType: 'duplicate_in_upload',
              issueLabel: 'Duplicate',
              issueDetail: isFirstDuplicateRow
                ? 'Duplicate group source row'
                : `Duplicate of ${firstRow ? reviewRowLabel(firstRow.sourceRow, firstRow.sourceSheet) : 'another uploaded row'}`,
              values: reviewValuesForRow({
                context,
                sourceRow: rowForReview.sourceRow,
                normalizedValues: rowForReview.values,
                rowId,
                rowOverrides,
              }),
              columns: context?.columns ?? [],
              problemFields: problemColumns(context, Object.keys(rowForReview.naturalKeyDisplay)),
              duplicateGroupKey,
              ...(firstRowId && !isFirstDuplicateRow
                ? {
                    duplicateOfRowId: firstRow
                      ? reviewRowLabel(firstRow.sourceRow, firstRow.sourceSheet)
                      : firstRowId,
                  }
                : {}),
              decision:
                rowDecisions.get(rowId) ??
                (shouldBlockDuplicateInUpload(tableId, deps.domainConfig)
                  ? 'keep_row'
                  : 'skip_row'),
              editable: true,
            });
          }
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

        for (const stagedRow of staged) {
          if (stagedRow.changeType !== 'exact_duplicate') continue;
          const context = getReviewContext(reviewContexts, tableId, stagedRow.sourceSheet);
          const key = `${reviewRowId(
            tableId,
            stagedRow.sourceRow,
            stagedRow.sourceSheet,
          )}:exact_duplicate`;
          if (reviewRowKeys.has(key)) continue;
          reviewRowKeys.add(key);
          const rowId = reviewRowId(tableId, stagedRow.sourceRow, stagedRow.sourceSheet);
          reviewRows.push({
            id: rowId,
            groupId: `${tableId}:exact_duplicate`,
            groupLabel: 'Rows to skip',
            tableId,
            ...(stagedRow.sourceSheet ? { sourceSheet: stagedRow.sourceSheet } : {}),
            sourceRow: stagedRow.sourceRow,
            status: 'skipped',
            issueType: 'exact_duplicate',
            issueLabel: 'Skipped',
            issueDetail: 'Exact duplicate already exists in PMO data',
            values: reviewValuesForRow({
              context,
              sourceRow: stagedRow.sourceRow,
              normalizedValues: stagedRow.values,
              rowId,
              rowOverrides,
            }),
            columns: context?.columns ?? [],
            problemFields: [],
            decision: 'skipped',
          });
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
      const blockingIssuesByRow = new Map<string, BlockingIssue[]>();
      for (const issue of blockingIssues) {
        const key = `${issue.tableId}:${issue.sourceSheet ?? ''}:${issue.sourceRow}`;
        blockingIssuesByRow.set(key, [...(blockingIssuesByRow.get(key) ?? []), issue]);
      }
      for (const [key, issues] of blockingIssuesByRow.entries()) {
        const [tableId = '', sourceSheet = '', sourceRowRaw = '0'] = key.split(':');
        const sourceRow = Number(sourceRowRaw);
        const context = getReviewContext(reviewContexts, tableId, sourceSheet || undefined);
        const normalizedRow = normalizedTables[tableId]?.find(
          (row) =>
            row.sourceRow === sourceRow && (sourceSheet ? row.sourceSheet === sourceSheet : true),
        );
        const issueTypes = new Set(issues.map((issue) => issueTypeForBlockingReason(issue.reason)));
        const issueType =
          issueTypes.size > 1 ? 'parse_error' : (issueTypes.values().next().value ?? 'parse_error');
        const problemFieldNames = issues.map((issue) => issue.field);
        const problemFieldLabels = problemColumns(context, problemFieldNames);
        const detail = issues.map((issue) => issue.reason).join('; ');
        const reviewKey = `${reviewRowId(tableId, sourceRow, sourceSheet || undefined)}:blocking`;
        if (reviewRowKeys.has(reviewKey)) continue;
        reviewRowKeys.add(reviewKey);
        const rowId = reviewRowId(tableId, sourceRow, sourceSheet || undefined);
        reviewRows.push({
          id: rowId,
          groupId: `${tableId}:${issueType}`,
          groupLabel: issueTypes.size > 1 ? 'Multiple issues' : groupLabelForType(issueType),
          tableId,
          ...(sourceSheet ? { sourceSheet } : {}),
          sourceRow,
          status: 'blocked',
          issueType,
          issueLabel: issueTypes.size > 1 ? 'Multiple issues' : issueLabelForType(issueType),
          issueDetail: detail,
          values: reviewValuesForRow({
            context,
            sourceRow,
            normalizedValues: normalizedRow?.values ?? {},
            rowId,
            rowOverrides,
          }),
          columns: context?.columns ?? [],
          problemFields: problemFieldLabels,
          decision: rowDecisions.get(rowId) ?? 'keep_row',
          editable: true,
        });
      }
      const unresolvedBlockingDuplicateGroups = new Set<string>();
      for (const row of duplicateInUploadRows) {
        if (row.policy === 'block' && row.duplicateGroupKey) {
          unresolvedBlockingDuplicateGroups.add(row.duplicateGroupKey);
        }
      }
      for (const groupKey of [...unresolvedBlockingDuplicateGroups]) {
        const groupRows = reviewRows.filter(
          (row) => row.issueType === 'duplicate_in_upload' && row.duplicateGroupKey === groupKey,
        );
        const sourceRows = groupRows.filter((row) => !row.duplicateOfRowId);
        const duplicateRows = groupRows.filter((row) => row.duplicateOfRowId);
        const sourceKept = sourceRows.length === 1 && sourceRows[0]?.decision === 'keep_row';
        const duplicatesSkipped =
          duplicateRows.length > 0 && duplicateRows.every((row) => row.decision === 'skip_row');
        if (sourceKept && duplicatesSkipped) {
          unresolvedBlockingDuplicateGroups.delete(groupKey);
        }
      }
      reviewRows.sort((a, b) => {
        const tableCompare = a.tableId.localeCompare(b.tableId);
        if (tableCompare !== 0) return tableCompare;
        const groupCompare = a.groupLabel.localeCompare(b.groupLabel);
        if (groupCompare !== 0) return groupCompare;
        const duplicateCompare = (a.duplicateGroupKey ?? '').localeCompare(
          b.duplicateGroupKey ?? '',
        );
        if (duplicateCompare !== 0) return duplicateCompare;
        return a.sourceRow - b.sourceRow;
      });
      const hasBlockingIssues = blockingIssues.length > 0;
      const hasUpdates = changeSummary.some(
        (table) => table.counts.new_records + table.counts.updated_records > 0,
      );
      const hasBlockingDuplicates = unresolvedBlockingDuplicateGroups.size > 0;
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
        reviewRows,
      };
      const nextAllowedActions: ReviewAction[] = ['approve', 'reject', 'rerun'];
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
            reviewRows,
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
            reviewRows,
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
        const skippedRowIds = new Set([
          ...[...rowDecisions.entries()]
            .filter(([, decision]) => decision === 'skip_row')
            .map(([rowId]) => rowId),
          ...reviewRows.filter((row) => row.decision === 'skip_row').map((row) => row.id),
        ]);
        const stagedForInsert = allStaged.filter(
          (entry) =>
            !skippedRowIds.has(reviewRowId(entry.tableId, entry.sourceRow, entry.sourceSheet)),
        );
        if (stagedForInsert.length > 0) {
          await db.insert(stagingChanges).values(
            stagedForInsert.map((entry) => ({
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
