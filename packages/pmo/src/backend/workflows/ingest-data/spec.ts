import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import { detectSchema } from '../../ingestion/detect-schema.ts';
import type { PmoFileStore } from '../../ingestion/file-store.ts';
import { normalizeRows } from '../../ingestion/normalize-rows.ts';
import { parseWorkbook } from '../../ingestion/parse-workbook.ts';
import {
  ConfirmOutputSchema,
  DetectOutputSchema,
  IngestInputSchema,
  MappingCardSchema,
  MappingDecisionSchema,
  PublishDecisionSchema,
  PublishOutputSchema,
  PublishReviewCardSchema,
  StagingOutputSchema,
} from './schemas.ts';

// ── Step 1: Detect schema ────────────────────────────────────────────────────

const detectStep = createStep({
  id: 'pmo.ingest.detect',
  description: 'Parses workbook, profiles columns, detects sheet roles, maps columns, validates.',
  inputSchema: IngestInputSchema,
  outputSchema: DetectOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const fileStore = requestContext.get('pmoFileStore') as PmoFileStore;
    const buffer = await fileStore.getBuffer(inputData.fileKey);

    const result = await detectSchema(buffer);

    return {
      ingestionSessionId: inputData.ingestionSessionId,
      tableMappings: result.tables.map((t) => ({
        tableId: t.tableId,
        sourceSheet: t.sourceSheet,
        headerRow: t.headerRow,
        tableConfidence: t.tableConfidence,
        mappings: t.mappings.map((m) => ({
          sourceColumn: m.sourceColumn,
          canonicalField: m.canonicalField,
          confidence: m.confidence,
          status: m.status,
        })),
        unmappedRequired: t.unmappedRequired,
        ambiguous: t.ambiguous,
      })),
      validationStatus: result.validation.status,
      workbookConfidence: result.validation.workbookConfidence,
    };
  },
});

// ── Step 2: Confirm mapping (HITL gate 1) ────────────────────────────────────

const confirmMappingStep = createStep({
  id: 'pmo.ingest.confirmMapping',
  description:
    'Auto-passes high confidence mappings; suspends for PMO review if needs_review/blocked.',
  inputSchema: DetectOutputSchema,
  outputSchema: ConfirmOutputSchema,
  suspendSchema: MappingCardSchema,
  resumeSchema: MappingDecisionSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      if (inputData.validationStatus === 'confirmed') {
        return {
          ingestionSessionId: inputData.ingestionSessionId,
          confirmedMappings: inputData.tableMappings,
        };
      }
      const allowApprove = inputData.validationStatus !== 'blocked';
      return suspend({
        meta: { toolId: 'pmo_confirmMapping' as const },
        ingestionSessionId: inputData.ingestionSessionId,
        proposedMappings: inputData.tableMappings,
        issues: [], // populated from validation in real impl
        workbookConfidence: inputData.workbookConfidence,
        allowApprove,
      });
    }

    if (resumeData.decision === 'reject') {
      throw new Error('rejected_by_user');
    }
    if (resumeData.decision === 'approve' && inputData.validationStatus === 'blocked') {
      throw new Error('cannot_approve_blocked_mapping');
    }

    const mappings =
      resumeData.decision === 'modify' && resumeData.modifiedMappings
        ? resumeData.modifiedMappings
        : inputData.tableMappings;

    return {
      ingestionSessionId: inputData.ingestionSessionId,
      confirmedMappings: mappings,
    };
  },
});

// ── Step 3: Normalize to staging ─────────────────────────────────────────────

const normalizeToStagingStep = createStep({
  id: 'pmo.ingest.normalizeToStaging',
  description:
    'Parses file again, normalizes rows, computes hashes, compares with active data, generates change summary.',
  inputSchema: ConfirmOutputSchema,
  outputSchema: StagingOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const fileStore = requestContext.get('pmoFileStore') as PmoFileStore;
    const sessionId = inputData.ingestionSessionId;

    // Re-parse file for row data
    const fileKey = requestContext.get('fileKey') as string;
    const buffer = await fileStore.getBuffer(fileKey);
    const parseResult = await parseWorkbook(buffer);

    // Normalize using confirmed mappings
    const tableMappings = inputData.confirmedMappings.map((t) => ({
      ...t,
      mappings: t.mappings.map((m) => ({
        ...m,
        evidence: '',
        scoringBreakdown: {
          headerSimilarity: 0,
          valuePattern: 0,
          dataType: 0,
          sheetContext: 0,
          crossSheet: 0,
        },
      })),
    }));
    const normResult = normalizeRows(parseResult.sheets, tableMappings);

    // TODO: Compute natural_key_hash + source_row_hash per row
    // TODO: Compare against active DB data
    // TODO: Write staging_changes to DB
    // TODO: Generate change summary with counts

    // For now, return staging output assuming all new (first upload)
    const changeSummary = Object.entries(normResult.rowCounts).map(([tableId, count]) => ({
      tableId,
      counts: {
        new_records: count,
        updated_records: 0,
        exact_duplicates: 0,
        duplicates_in_upload: 0,
      },
      sampleChanges: [],
    }));

    const hasUpdates = changeSummary.some(
      (t) => t.counts.updated_records > 0 || t.counts.duplicates_in_upload > 0,
    );

    return {
      ingestionSessionId: sessionId,
      changeSummary,
      hasUpdates,
      requiresReview: hasUpdates,
    };
  },
});

// ── Step 4: Review changes + publish (HITL gate 2) ───────────────────────────

const reviewChangesStep = createStep({
  id: 'pmo.ingest.reviewChanges',
  description: 'Auto-publishes if only new/exact_dup; suspends for PMO review if updates detected.',
  inputSchema: StagingOutputSchema,
  outputSchema: PublishOutputSchema,
  suspendSchema: PublishReviewCardSchema,
  resumeSchema: PublishDecisionSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      if (!inputData.requiresReview) {
        // All new records or exact duplicates — auto-publish
        // TODO: Execute actual upsert to canonical tables
        const rowsWritten: Record<string, number> = {};
        const rowsUpdated: Record<string, number> = {};
        const rowsSkipped: Record<string, number> = {};
        for (const table of inputData.changeSummary) {
          rowsWritten[table.tableId] = table.counts.new_records;
          rowsUpdated[table.tableId] = table.counts.updated_records;
          rowsSkipped[table.tableId] = table.counts.exact_duplicates;
        }
        return {
          ingestionSessionId: inputData.ingestionSessionId,
          rowsWritten,
          rowsUpdated,
          rowsSkipped,
          status: 'published' as const,
        };
      }

      // Has updates or duplicates — PMO must review
      const hasDuplicatesInUpload = inputData.changeSummary.some(
        (t) => t.counts.duplicates_in_upload > 0,
      );
      return suspend({
        meta: { toolId: 'pmo_confirmPublish' as const },
        ingestionSessionId: inputData.ingestionSessionId,
        changeSummary: inputData.changeSummary,
        allowApprove: !hasDuplicatesInUpload,
      });
    }

    // User responded
    if (resumeData.decision === 'reject') {
      return {
        ingestionSessionId: inputData.ingestionSessionId,
        rowsWritten: {},
        rowsUpdated: {},
        rowsSkipped: {},
        status: 'rejected' as const,
      };
    }

    // Approved — execute upsert
    // TODO: Read staging_changes, execute ON CONFLICT DO UPDATE
    const rowsWritten: Record<string, number> = {};
    const rowsUpdated: Record<string, number> = {};
    const rowsSkipped: Record<string, number> = {};
    for (const table of inputData.changeSummary) {
      rowsWritten[table.tableId] = table.counts.new_records;
      rowsUpdated[table.tableId] = table.counts.updated_records;
      rowsSkipped[table.tableId] = table.counts.exact_duplicates;
    }

    return {
      ingestionSessionId: inputData.ingestionSessionId,
      rowsWritten,
      rowsUpdated,
      rowsSkipped,
      status: 'published' as const,
    };
  },
});

// ── Workflow composition ─────────────────────────────────────────────────────

export const ingestDataWorkflow = createWorkflow({
  id: 'pmo.ingestData',
  inputSchema: IngestInputSchema,
  outputSchema: PublishOutputSchema,
  retryConfig: { attempts: 2, delay: 1000 },
})
  .then(detectStep)
  .then(confirmMappingStep)
  .then(normalizeToStagingStep)
  .then(reviewChangesStep)
  .commit();

export const ingestDataWorkflowSpec: WorkflowSpec = {
  domain: 'work',
  id: 'ingestData',
  description:
    'Ingests PMO workbook: detect schema, confirm mapping, normalize to staging, review changes, publish with upsert.',
  inputSchema: IngestInputSchema,
  outputSchema: PublishOutputSchema,
  workflow: ingestDataWorkflow,
  hitlSteps: ['pmo.ingest.confirmMapping', 'pmo.ingest.reviewChanges'],
};
