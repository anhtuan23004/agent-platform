import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import type { z } from 'zod';
import { detectSchema } from '../../ingestion/detect-schema.ts';
import { normalizeRows } from '../../ingestion/normalize-rows.ts';
import { parseWorkbook } from '../../ingestion/parse-workbook.ts';
import { createS3FileStore } from '../../ingestion/s3-file-store.ts';
import {
  type ActiveRecord,
  aggregateTimesheetRows,
  classifyRows,
  type StagedRow,
  shouldBlockDuplicateInUpload,
} from '../../ingestion/stage-changes.ts';
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
    // Resolve file store: injected via requestContext or fallback to S3
    const fileStore =
      (requestContext.get(
        'pmoFileStore',
      ) as import('../../ingestion/file-store.ts').PmoFileStore) ??
      createS3FileStore(process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020');
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
    const fileStore =
      (requestContext.get(
        'pmoFileStore',
      ) as import('../../ingestion/file-store.ts').PmoFileStore) ??
      createS3FileStore(process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020');
    const sessionId = inputData.ingestionSessionId;

    // Re-parse file for row data — get fileKey from requestContext or derive from session
    const fileKey =
      (requestContext.get('fileKey') as string) ??
      inputData.confirmedMappings[0]?.sourceSheet ??
      '';
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

    // Classify rows: compute hashes, compare with active DB, detect duplicates
    const { pmoDb } = await import('../../db/client.ts');
    const {
      resourceAllocations,
      timesheets,
      leaveRecords,
      memberMaster,
      projectMaster,
      overbookIdleConfig,
      calendarWeeks,
      kpiNorms,
      stagingChanges,
    } = await import('../../db/schema.ts');
    const { eq, and } = await import('drizzle-orm');
    const db = pmoDb();
    const tenantId = requestContext.get('tenant_id') as string;

    const tableToSchema: Record<
      string,
      {
        natural_key_hash: unknown;
        source_row_hash: unknown;
        tenant_id: unknown;
        is_active: unknown;
      }
    > = {
      resource_allocation: resourceAllocations as never,
      timesheet: timesheets as never,
      leave: leaveRecords as never,
      member_master: memberMaster as never,
      project_master: projectMaster as never,
      overbook_idle_config: overbookIdleConfig as never,
      calendar_weeks: calendarWeeks as never,
      kpi_norms: kpiNorms as never,
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
      // Timesheet aggregation before dedup
      const processedRows = tableId === 'timesheet' ? aggregateTimesheetRows(tenantId, rows) : rows;

      // Fetch active records from DB for comparison
      let activeRecords: ActiveRecord[] = [];
      const tableSchema = tableToSchema[tableId];
      if (tableSchema) {
        const results = await (db as never as { select: Function })
          .select({
            natural_key_hash: (tableSchema as { natural_key_hash: unknown }).natural_key_hash,
            source_row_hash: (tableSchema as { source_row_hash: unknown }).source_row_hash,
          })
          .from(tableSchema)
          .where(
            and(
              eq((tableSchema as { tenant_id: unknown }).tenant_id as never, tenantId as never),
              eq((tableSchema as { is_active: unknown }).is_active as never, true as never),
            ),
          );
        activeRecords = results as ActiveRecord[];
      }

      // Classify each row
      const staged = classifyRows(tableId, tenantId, processedRows, activeRecords);
      allStaged.push(...staged);

      // Compute counts
      const counts = {
        new_records: 0,
        updated_records: 0,
        exact_duplicates: 0,
        duplicates_in_upload: 0,
      };
      for (const s of staged) {
        counts[`${s.changeType}s` as keyof typeof counts]++;
      }
      // Fix key names
      const finalCounts = {
        new_records: counts.new_records,
        updated_records: counts.updated_records,
        exact_duplicates: counts.exact_duplicates,
        duplicates_in_upload: counts.duplicates_in_upload,
      };

      const sampleChanges = staged
        .filter((s) => s.changeType !== 'exact_duplicate')
        .slice(0, 5)
        .map((s) => ({
          type: s.changeType as 'new_record' | 'updated_record' | 'duplicate_in_upload',
          naturalKey: s.naturalKeyDisplay,
          newValues: s.values,
        }));

      changeSummary.push({ tableId, counts: finalCounts, sampleChanges });
    }

    // Write staging changes to DB
    if (allStaged.length > 0) {
      const stagingRows = allStaged.map((s) => ({
        ingestion_session_id: sessionId,
        table_id: s.tableId,
        natural_key_hash: s.naturalKeyHash,
        change_type: s.changeType,
        new_values: s.values,
        natural_key_display: s.naturalKeyDisplay,
        old_values: s.oldValues ?? null,
      }));
      await db.insert(stagingChanges).values(stagingRows);
    }

    const hasUpdates = changeSummary.some(
      (t) =>
        t.counts.updated_records > 0 ||
        (t.counts.duplicates_in_upload > 0 && shouldBlockDuplicateInUpload(t.tableId)),
    );

    return {
      ingestionSessionId: sessionId,
      changeSummary: changeSummary as z.infer<typeof StagingOutputSchema>['changeSummary'],
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
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    if (!resumeData) {
      if (!inputData.requiresReview) {
        // All new records or exact duplicates — auto-publish
        const { publishUpsert } = await import('../../ingestion/publish-upsert.ts');
        const tenantId = (requestContext.get('tenant_id') as string) ?? '';
        const result = await publishUpsert(inputData.ingestionSessionId, tenantId);
        return {
          ingestionSessionId: inputData.ingestionSessionId,
          ...result,
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
    const { publishUpsert } = await import('../../ingestion/publish-upsert.ts');
    const tenantId = (requestContext.get('tenant_id') as string) ?? '';
    const result = await publishUpsert(inputData.ingestionSessionId, tenantId);
    return {
      ingestionSessionId: inputData.ingestionSessionId,
      ...result,
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
