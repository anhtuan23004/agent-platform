import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import { and as drizzleAnd, eq as drizzleEq } from 'drizzle-orm';
import type { z } from 'zod';
import { pmoDb as getPmoDb } from '../../db/client.ts';
import { ingestionSessions } from '../../db/schema.ts';
import { PMO_CANONICAL_SCHEMA } from '../../ingestion/canonical-schema.ts';
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
  buildMappingItemReviewCard,
  buildMappingReviewRows,
  buildPublishReviewCard,
  collectMappingDisplayItems,
  collectMappingReviewItems,
} from './cards.ts';
import { shouldBlockPublishApprove } from './review-gates.ts';
import {
  type RuntimeWorkflowStepId,
  type RuntimeWorkflowTransition,
  readCurrentStepName,
  readWorkflowExecutionState,
  upsertRuntimeExecutionState,
} from './runtime-execution-state.ts';
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

type BlockingIssue = z.infer<typeof StagingOutputSchema>['blockingIssues'][number];
type DetectTableMapping = z.infer<typeof DetectOutputSchema>['tableMappings'][number];
type MappingOverride = NonNullable<z.infer<typeof MappingDecisionSchema>['mappingOverride']>;
type MappingReviewRow = z.infer<typeof ConfirmOutputSchema>['mappingReviewRows'][number];

type RuntimeSessionStatus =
  | 'approved_plan'
  | 'profiling'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'normalizing'
  | 'staging_normalized'
  | 'awaiting_publish_review'
  | 'published'
  | 'failed'
  | 'rejected'
  | 'cancelled';

const REQUIRED_FIELDS_BY_TABLE = new Map<string, string[]>(
  PMO_CANONICAL_SCHEMA.tables.map((table) => [
    table.id,
    table.fields.filter((field) => field.required).map((field) => field.name),
  ]),
);

function isMissingRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

function normalizeReferenceId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const asText = typeof value === 'string' ? value.trim() : String(value).trim();
  if (!asText) return null;
  return asText.toLowerCase();
}

function collectReferenceIds(
  rows: Array<{ values: Record<string, unknown> }>,
  field: string,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const normalized = normalizeReferenceId(row.values[field]);
    if (normalized) ids.add(normalized);
  }
  return ids;
}

function resolveCardIdentity(requestContext: { get: (key: string) => unknown }): {
  tenantId: string;
  userId: string;
} {
  const actor = requestContext.get('actor') as { user_id?: string } | undefined;
  const tenantId = (requestContext.get('tenant_id') as string | undefined) ?? '';
  const userId = actor?.user_id ?? '';
  return { tenantId, userId };
}

function mappingOverrideKey(override: Pick<MappingOverride, 'tableId' | 'field'>): string {
  return `${override.tableId}|${override.field}`;
}

function mergeMappingOverrides(
  existing: MappingOverride[],
  incoming?: MappingOverride,
): MappingOverride[] {
  const byKey = new Map<string, MappingOverride>();
  for (const override of existing) {
    byKey.set(mappingOverrideKey(override), override);
  }
  if (incoming) {
    byKey.set(mappingOverrideKey(incoming), incoming);
  }
  return [...byKey.values()];
}

function applyMappingOverrides(
  tableMappings: DetectTableMapping[],
  mappingOverrides: MappingOverride[],
): DetectTableMapping[] {
  if (mappingOverrides.length === 0) return tableMappings;

  const overridesByTable = new Map<string, MappingOverride[]>();
  for (const override of mappingOverrides) {
    const list = overridesByTable.get(override.tableId) ?? [];
    list.push(override);
    overridesByTable.set(override.tableId, list);
  }

  return tableMappings.map((table) => {
    const tableOverrides = overridesByTable.get(table.tableId) ?? [];
    if (tableOverrides.length === 0) return table;

    const overrideByField = new Map<string, MappingOverride>();
    for (const override of tableOverrides) {
      overrideByField.set(override.field, override);
    }

    const nextSourceByField = new Map<string, string>();
    for (const mapping of table.mappings) {
      const override = overrideByField.get(mapping.canonicalField);
      nextSourceByField.set(mapping.canonicalField, override?.sourceColumn ?? mapping.sourceColumn);
    }
    for (const override of tableOverrides) {
      if (!nextSourceByField.has(override.field)) {
        nextSourceByField.set(override.field, override.sourceColumn);
      }
    }

    const fieldBySourceColumn = new Map<string, string>();
    for (const [field, sourceColumn] of nextSourceByField.entries()) {
      const existingField = fieldBySourceColumn.get(sourceColumn);
      if (existingField && existingField !== field) {
        throw new Error(`mapping_override_conflict:${table.tableId}:${sourceColumn}`);
      }
      fieldBySourceColumn.set(sourceColumn, field);
    }

    const nextMappings: DetectTableMapping['mappings'] = table.mappings.map((mapping) => {
      const override = overrideByField.get(mapping.canonicalField);
      if (!override) return mapping;

      if (
        mapping.candidates?.length &&
        !mapping.candidates.some((candidate) => candidate.sourceColumn === override.sourceColumn)
      ) {
        throw new Error(
          `invalid_mapping_override_candidate:${table.tableId}:${mapping.canonicalField}:${override.sourceColumn}`,
        );
      }

      const selectedCandidate = mapping.candidates?.find(
        (candidate) => candidate.sourceColumn === override.sourceColumn,
      );
      const confidence = override.confidence ?? selectedCandidate?.confidence ?? mapping.confidence;
      const blocked = override.blocked ?? selectedCandidate?.blocked ?? false;
      const status: DetectTableMapping['mappings'][number]['status'] = blocked
        ? 'blocked'
        : 'needs_review';

      return {
        ...mapping,
        sourceColumn: override.sourceColumn,
        confidence,
        status,
      };
    });

    for (const override of tableOverrides) {
      if (nextMappings.some((mapping) => mapping.canonicalField === override.field)) continue;

      const status: DetectTableMapping['mappings'][number]['status'] = override.blocked
        ? 'blocked'
        : 'needs_review';
      nextMappings.push({
        sourceColumn: override.sourceColumn,
        canonicalField: override.field,
        confidence: override.confidence ?? 0.7,
        status,
        candidates: [
          {
            sourceColumn: override.sourceColumn,
            confidence: override.confidence ?? 0.7,
            blocked: Boolean(override.blocked),
          },
        ],
      });
    }

    const mappedFields = new Set(nextMappings.map((mapping) => mapping.canonicalField));
    const requiredFields = REQUIRED_FIELDS_BY_TABLE.get(table.tableId) ?? [];
    const requiredConfidenceSum = requiredFields.reduce((sum, field) => {
      const mapped = nextMappings.find((mapping) => mapping.canonicalField === field);
      return sum + (mapped?.confidence ?? 0);
    }, 0);
    const tableConfidence =
      requiredFields.length > 0
        ? Math.round((requiredConfidenceSum / requiredFields.length) * 100) / 100
        : table.tableConfidence;

    return {
      ...table,
      tableConfidence,
      mappings: nextMappings,
      unmappedRequired: table.unmappedRequired.filter((field) => !mappedFields.has(field)),
      ambiguous: table.ambiguous.filter((field) => !overrideByField.has(field)),
    };
  });
}

function asDateOrNull(input: string | null | undefined): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function syncRuntimeExecutionState(params: {
  ingestionSessionId: string;
  requestContext: { get: (key: string) => unknown };
  runtimeStepId: RuntimeWorkflowStepId;
  transition: RuntimeWorkflowTransition;
  status?: RuntimeSessionStatus;
}): Promise<void> {
  const tenantId = params.requestContext.get('tenant_id');
  if (typeof tenantId !== 'string' || tenantId.length === 0) return;

  try {
    const db = getPmoDb();
    const rows = await db
      .select({
        status: ingestionSessions.status,
        planning_plan: ingestionSessions.planning_plan,
        workflow_execution_state: ingestionSessions.workflow_execution_state,
      })
      .from(ingestionSessions)
      .where(
        drizzleAnd(
          drizzleEq(ingestionSessions.id, params.ingestionSessionId),
          drizzleEq(ingestionSessions.tenant_id, tenantId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return;

    const existingExecutionState = readWorkflowExecutionState(row.workflow_execution_state);
    if (params.runtimeStepId === 'pmo.ingest.detect' && params.transition !== 'failed') {
      const detectStepNo =
        existingExecutionState?.steps.find((step) => /profil|schema|detect/i.test(step.step_name))
          ?.step_no ?? existingExecutionState?.steps[0]?.step_no;

      if (
        typeof detectStepNo === 'number' &&
        typeof existingExecutionState?.current_step_no === 'number' &&
        existingExecutionState.current_step_no > detectStepNo
      ) {
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const nextExecutionState = upsertRuntimeExecutionState({
      existingState: existingExecutionState ?? row.workflow_execution_state,
      planningPlan: row.planning_plan,
      runtimeStepId: params.runtimeStepId,
      transition: params.transition,
      nowIso,
    });

    const nextStatus = params.status ?? row.status;

    await db
      .update(ingestionSessions)
      .set({
        status: nextStatus,
        workflow_execution_state: nextExecutionState,
        workflow_current_step: readCurrentStepName(nextExecutionState),
        workflow_step_status: nextExecutionState.current_step_status,
        workflow_started_at: asDateOrNull(nextExecutionState.started_at),
        workflow_updated_at: asDateOrNull(nextExecutionState.updated_at),
        finished_at:
          nextStatus === 'published' ||
          nextStatus === 'failed' ||
          nextStatus === 'rejected' ||
          nextStatus === 'cancelled'
            ? asDateOrNull(nowIso)
            : null,
      })
      .where(
        drizzleAnd(
          drizzleEq(ingestionSessions.id, params.ingestionSessionId),
          drizzleEq(ingestionSessions.tenant_id, tenantId),
        ),
      );
  } catch (error) {
    console.warn('[pmo.ingest.runtime-sync] failed to persist workflow execution state', {
      ingestionSessionId: params.ingestionSessionId,
      runtimeStepId: params.runtimeStepId,
      transition: params.transition,
      error,
    });
  }
}

// ── Step 1: Detect schema ────────────────────────────────────────────────────

const detectStep = createStep({
  id: 'pmo.ingest.detect',
  description: 'Parses workbook, profiles columns, detects sheet roles, maps columns, validates.',
  inputSchema: IngestInputSchema,
  outputSchema: DetectOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    await syncRuntimeExecutionState({
      ingestionSessionId: inputData.ingestionSessionId,
      requestContext,
      runtimeStepId: 'pmo.ingest.detect',
      transition: 'in_progress',
      status: 'profiling',
    });

    try {
      const fileStore =
        (requestContext.get(
          'pmoFileStore',
        ) as import('../../ingestion/file-store.ts').PmoFileStore) ??
        createS3FileStore(process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020');
      const buffer = await fileStore.getBuffer(inputData.fileKey);

      const result = await detectSchema(buffer);

      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.detect',
        transition: 'completed',
        status: 'awaiting_confirmation',
      });

      return {
        ingestionSessionId: inputData.ingestionSessionId,
        fileKey: inputData.fileKey,
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
            candidates: m.candidates,
          })),
          unmappedRequired: t.unmappedRequired,
          ambiguous: t.ambiguous,
        })),
        validationStatus: result.validation.status,
        workbookConfidence: result.validation.workbookConfidence,
      };
    } catch (error) {
      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.detect',
        transition: 'failed',
        status: 'failed',
      });
      throw error;
    }
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
  execute: async ({ inputData, resumeData, suspend, requestContext, runId }) => {
    await syncRuntimeExecutionState({
      ingestionSessionId: inputData.ingestionSessionId,
      requestContext,
      runtimeStepId: 'pmo.ingest.confirmMapping',
      transition: 'in_progress',
      status: 'awaiting_confirmation',
    });

    const actorUserId = resolveCardIdentity(requestContext).userId;

    try {
      if (!resumeData) {
        const reviewItems = collectMappingReviewItems(inputData.tableMappings);
        const displayItems = collectMappingDisplayItems(inputData.tableMappings, reviewItems);
        if (inputData.validationStatus === 'confirmed' || reviewItems.length === 0) {
          const mappingReviewRows: MappingReviewRow[] = buildMappingReviewRows({
            displayItems,
            reviewItems,
            approvedItemIds: reviewItems.map((item) => item.id),
            approvedByByItemKey: {},
            fallbackApprovedBy: actorUserId,
            currentItemId: null,
            awaitingNextStep: true,
          });

          await syncRuntimeExecutionState({
            ingestionSessionId: inputData.ingestionSessionId,
            requestContext,
            runtimeStepId: 'pmo.ingest.confirmMapping',
            transition: 'completed',
            status: 'confirmed',
          });

          return {
            ingestionSessionId: inputData.ingestionSessionId,
            fileKey: inputData.fileKey,
            confirmedMappings: inputData.tableMappings,
            mappingReviewRows,
          };
        }

        const firstItem = reviewItems[0];
        if (!firstItem) {
          throw new Error('mapping_review_items_empty');
        }

        await syncRuntimeExecutionState({
          ingestionSessionId: inputData.ingestionSessionId,
          requestContext,
          runtimeStepId: 'pmo.ingest.confirmMapping',
          transition: 'needs_review',
          status: 'awaiting_confirmation',
        });

        return suspend(
          buildMappingItemReviewCard({
            ingestionSessionId: inputData.ingestionSessionId,
            workbookConfidence: inputData.workbookConfidence,
            validationStatus: inputData.validationStatus,
            tableMappings: inputData.tableMappings,
            reviewItems,
            approvedItemIds: [],
            approvedByByItemKey: {},
            mappingOverrides: [],
            currentItemId: firstItem.id,
            identity: resolveCardIdentity(requestContext),
            toolCallId: `workflow:${runId}:pmo_confirmMapping`,
          }),
        );
      }

      if (resumeData.decision === 'reject') {
        await syncRuntimeExecutionState({
          ingestionSessionId: inputData.ingestionSessionId,
          requestContext,
          runtimeStepId: 'pmo.ingest.confirmMapping',
          transition: 'failed',
          status: 'rejected',
        });
        throw new Error('rejected_by_user');
      }

      const mergedOverrides = mergeMappingOverrides(
        resumeData.mappingOverrides ?? [],
        resumeData.mappingOverride ?? undefined,
      );
      const effectiveMappings = applyMappingOverrides(inputData.tableMappings, mergedOverrides);
      const reviewItems = collectMappingReviewItems(effectiveMappings);
      const displayItems = collectMappingDisplayItems(effectiveMappings, reviewItems);
      const approvedByByItemKey: Record<string, string> = {
        ...(resumeData.approvedByByItemKey ?? {}),
      };

      const validIds = new Set(reviewItems.map((item) => item.id));
      const approved = new Set<string>();
      for (const id of resumeData.approvedItemKeys ?? []) {
        if (validIds.has(id)) approved.add(id);
      }
      if (resumeData.approvedItemKey && validIds.has(resumeData.approvedItemKey)) {
        approved.add(resumeData.approvedItemKey);
        if (resumeData.decision === 'approve' && actorUserId) {
          approvedByByItemKey[resumeData.approvedItemKey] = actorUserId;
        }
      }

      if (reviewItems.length > 0 && approved.size < reviewItems.length) {
        const nextItem = reviewItems.find((item) => !approved.has(item.id));
        if (!nextItem) {
          throw new Error('next_mapping_item_not_found');
        }

        await syncRuntimeExecutionState({
          ingestionSessionId: inputData.ingestionSessionId,
          requestContext,
          runtimeStepId: 'pmo.ingest.confirmMapping',
          transition: 'needs_review',
          status: 'awaiting_confirmation',
        });

        return suspend(
          buildMappingItemReviewCard({
            ingestionSessionId: inputData.ingestionSessionId,
            workbookConfidence: inputData.workbookConfidence,
            validationStatus: inputData.validationStatus,
            tableMappings: effectiveMappings,
            reviewItems,
            approvedItemIds: [...approved],
            approvedByByItemKey,
            mappingOverrides: mergedOverrides,
            currentItemId: nextItem.id,
            identity: resolveCardIdentity(requestContext),
            toolCallId: `workflow:${runId}:pmo_confirmMapping`,
          }),
        );
      }

      if (reviewItems.length > 0 && resumeData.proceedToNextStep !== true) {
        const firstItem = reviewItems[0];
        if (!firstItem) {
          throw new Error('mapping_review_items_empty');
        }

        await syncRuntimeExecutionState({
          ingestionSessionId: inputData.ingestionSessionId,
          requestContext,
          runtimeStepId: 'pmo.ingest.confirmMapping',
          transition: 'needs_review',
          status: 'awaiting_confirmation',
        });

        return suspend(
          buildMappingItemReviewCard({
            ingestionSessionId: inputData.ingestionSessionId,
            workbookConfidence: inputData.workbookConfidence,
            validationStatus: inputData.validationStatus,
            tableMappings: effectiveMappings,
            reviewItems,
            approvedItemIds: [...approved],
            approvedByByItemKey,
            mappingOverrides: mergedOverrides,
            currentItemId: firstItem.id,
            awaitingNextStep: true,
            identity: resolveCardIdentity(requestContext),
            toolCallId: `workflow:${runId}:pmo_confirmMapping`,
          }),
        );
      }

      const mappingReviewRows: MappingReviewRow[] = buildMappingReviewRows({
        displayItems,
        reviewItems,
        approvedItemIds: reviewItems.map((item) => item.id),
        approvedByByItemKey,
        fallbackApprovedBy: actorUserId,
        currentItemId: null,
        awaitingNextStep: true,
      });

      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.confirmMapping',
        transition: 'completed',
        status: 'confirmed',
      });

      return {
        ingestionSessionId: inputData.ingestionSessionId,
        fileKey: inputData.fileKey,
        confirmedMappings: effectiveMappings,
        mappingReviewRows,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'rejected_by_user') {
        throw error;
      }

      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.confirmMapping',
        transition: 'failed',
        status: 'failed',
      });
      throw error;
    }
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
    await syncRuntimeExecutionState({
      ingestionSessionId: inputData.ingestionSessionId,
      requestContext,
      runtimeStepId: 'pmo.ingest.normalizeToStaging',
      transition: 'in_progress',
      status: 'normalizing',
    });

    try {
      const fileStore =
        (requestContext.get(
          'pmoFileStore',
        ) as import('../../ingestion/file-store.ts').PmoFileStore) ??
        createS3FileStore(process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020');
      const sessionId = inputData.ingestionSessionId;

      const buffer = await fileStore.getBuffer(inputData.fileKey);
      const parseResult = await parseWorkbook(buffer);

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
            llmSemantic: 0,
          },
        })),
      }));
      const normResult = normalizeRows(parseResult.sheets, tableMappings);
      const blockingIssueMap = new Map<string, BlockingIssue>();
      const addBlockingIssue = (issue: BlockingIssue): void => {
        const key = `${issue.tableId}|${issue.sourceRow}|${issue.field}|${issue.reason}`;
        if (blockingIssueMap.has(key)) return;
        if (blockingIssueMap.size >= 200) return;
        blockingIssueMap.set(key, issue);
      };

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

      const [activeMemberRows, activeProjectRows] = await Promise.all([
        db
          .select({ member_id: memberMaster.member_id })
          .from(memberMaster)
          .where(and(eq(memberMaster.tenant_id, tenantId), eq(memberMaster.is_active, true))),
        db
          .select({ project_id: projectMaster.project_id })
          .from(projectMaster)
          .where(and(eq(projectMaster.tenant_id, tenantId), eq(projectMaster.is_active, true))),
      ]);

      const knownMemberIds = new Set<string>();
      const knownProjectIds = new Set<string>();

      for (const row of activeMemberRows) {
        const normalized = normalizeReferenceId(row.member_id);
        if (normalized) knownMemberIds.add(normalized);
      }
      for (const row of activeProjectRows) {
        const normalized = normalizeReferenceId(row.project_id);
        if (normalized) knownProjectIds.add(normalized);
      }

      for (const id of collectReferenceIds(normResult.tables.member_master ?? [], 'member_id')) {
        knownMemberIds.add(id);
      }
      for (const id of collectReferenceIds(normResult.tables.project_master ?? [], 'project_id')) {
        knownProjectIds.add(id);
      }

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
        const requiredFields = REQUIRED_FIELDS_BY_TABLE.get(tableId) ?? [];
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

        const processedRows =
          tableId === 'timesheet' ? aggregateTimesheetRows(tenantId, rows) : rows;

        const referenceRules: Array<{
          field: string;
          targetTable: 'member_master' | 'project_master';
          knownIds: Set<string>;
        }> = [];

        if (tableId === 'resource_allocation') {
          referenceRules.push(
            {
              field: 'member_id',
              targetTable: 'member_master',
              knownIds: knownMemberIds,
            },
            {
              field: 'project_id',
              targetTable: 'project_master',
              knownIds: knownProjectIds,
            },
          );
        } else if (tableId === 'timesheet') {
          referenceRules.push(
            {
              field: 'member_id',
              targetTable: 'member_master',
              knownIds: knownMemberIds,
            },
            {
              field: 'project_id',
              targetTable: 'project_master',
              knownIds: knownProjectIds,
            },
          );
        } else if (tableId === 'leave') {
          referenceRules.push({
            field: 'member_id',
            targetTable: 'member_master',
            knownIds: knownMemberIds,
          });
        }

        for (const row of processedRows) {
          for (const rule of referenceRules) {
            const rawValue = row.values[rule.field];
            const normalized = normalizeReferenceId(rawValue);
            if (!normalized) continue;
            if (rule.knownIds.has(normalized)) continue;

            addBlockingIssue({
              tableId,
              sourceRow: row.sourceRow,
              field: rule.field,
              reason: `unresolved reference: '${String(rawValue).trim()}' not found in ${rule.targetTable}`,
            });
          }
        }

        let activeRecords: ActiveRecord[] = [];
        const tableSchema = tableToSchema[tableId];
        if (tableSchema) {
          const dynamicDb = db as unknown as {
            select: (fields: Record<string, unknown>) => {
              from: (table: unknown) => {
                where: (condition: unknown) => Promise<unknown>;
              };
            };
          };
          const results = await dynamicDb
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

        const staged = classifyRows(tableId, tenantId, processedRows, activeRecords);
        allStaged.push(...staged);

        const counts = {
          new_records: 0,
          updated_records: 0,
          exact_duplicates: 0,
          duplicates_in_upload: 0,
        };
        for (const s of staged) {
          counts[`${s.changeType}s` as keyof typeof counts]++;
        }

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
      const blockingIssues = [...blockingIssueMap.values()];
      const hasBlockingIssues = blockingIssues.length > 0;

      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.normalizeToStaging',
        transition: 'completed',
        status: 'staging_normalized',
      });

      return {
        ingestionSessionId: sessionId,
        changeSummary: changeSummary as z.infer<typeof StagingOutputSchema>['changeSummary'],
        blockingIssues,
        mappingReviewRows: inputData.mappingReviewRows,
        hasBlockingIssues,
        hasUpdates,
        requiresReview: hasUpdates || hasBlockingIssues,
      };
    } catch (error) {
      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.normalizeToStaging',
        transition: 'failed',
        status: 'failed',
      });
      throw error;
    }
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
  execute: async ({ inputData, resumeData, suspend, requestContext, runId }) => {
    await syncRuntimeExecutionState({
      ingestionSessionId: inputData.ingestionSessionId,
      requestContext,
      runtimeStepId: 'pmo.ingest.reviewChanges',
      transition: 'in_progress',
      status: inputData.requiresReview ? 'awaiting_publish_review' : 'staging_normalized',
    });

    try {
      if (!resumeData) {
        if (!inputData.requiresReview) {
          const { publishUpsert } = await import('../../ingestion/publish-upsert.ts');
          const tenantId = (requestContext.get('tenant_id') as string) ?? '';
          const result = await publishUpsert(inputData.ingestionSessionId, tenantId);

          await syncRuntimeExecutionState({
            ingestionSessionId: inputData.ingestionSessionId,
            requestContext,
            runtimeStepId: 'pmo.ingest.reviewChanges',
            transition: 'completed',
            status: 'published',
          });

          return {
            ingestionSessionId: inputData.ingestionSessionId,
            ...result,
            status: 'published' as const,
          };
        }

        const blockedByReviewGate = shouldBlockPublishApprove({
          changeSummary: inputData.changeSummary,
          hasBlockingIssues: inputData.hasBlockingIssues,
        });

        await syncRuntimeExecutionState({
          ingestionSessionId: inputData.ingestionSessionId,
          requestContext,
          runtimeStepId: 'pmo.ingest.reviewChanges',
          transition: 'needs_review',
          status: 'awaiting_publish_review',
        });

        return suspend(
          buildPublishReviewCard({
            ingestionSessionId: inputData.ingestionSessionId,
            changeSummary: inputData.changeSummary,
            blockingIssues: inputData.blockingIssues,
            mappingReviewRows: inputData.mappingReviewRows,
            allowApprove: !blockedByReviewGate,
            identity: resolveCardIdentity(requestContext),
            toolCallId: `workflow:${runId}:pmo_confirmPublish`,
          }),
        );
      }

      if (resumeData.decision === 'reject') {
        await syncRuntimeExecutionState({
          ingestionSessionId: inputData.ingestionSessionId,
          requestContext,
          runtimeStepId: 'pmo.ingest.reviewChanges',
          transition: 'completed',
          status: 'rejected',
        });

        return {
          ingestionSessionId: inputData.ingestionSessionId,
          rowsWritten: {},
          rowsUpdated: {},
          rowsSkipped: {},
          status: 'rejected' as const,
        };
      }

      const blockedByReviewGate = shouldBlockPublishApprove({
        changeSummary: inputData.changeSummary,
        hasBlockingIssues: inputData.hasBlockingIssues,
      });
      if (blockedByReviewGate) {
        throw new Error('cannot_approve_blocked_publish');
      }

      const { publishUpsert } = await import('../../ingestion/publish-upsert.ts');
      const tenantId = (requestContext.get('tenant_id') as string) ?? '';
      const result = await publishUpsert(inputData.ingestionSessionId, tenantId);

      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.reviewChanges',
        transition: 'completed',
        status: 'published',
      });

      return {
        ingestionSessionId: inputData.ingestionSessionId,
        ...result,
        status: 'published' as const,
      };
    } catch (error) {
      await syncRuntimeExecutionState({
        ingestionSessionId: inputData.ingestionSessionId,
        requestContext,
        runtimeStepId: 'pmo.ingest.reviewChanges',
        transition: 'failed',
        status: 'failed',
      });
      throw error;
    }
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
