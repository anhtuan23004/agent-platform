import { describe, expect, it, vi } from 'vitest';
import { createWorkbookProfilingHandler } from '../../../../src/backend/workflows/ingest-data-v2/handlers/workbook-profiling.ts';
import type { PmoDynamicHandlerInput } from '../../../../src/backend/workflows/ingest-data-v2/types.ts';

const baseStep = {
  step_no: 1,
  planner_step_id: 'pmo.planner.step.1.workbook_profiling',
  action_id: 'workbook_profiling',
  review_type: 'profiling',
  step_name: 'Workbook profiling',
  status: 'in_progress',
} as const;

function makeInput(overrides: Partial<PmoDynamicHandlerInput> = {}): PmoDynamicHandlerInput {
  return {
    ingestionSessionId: '33333333-3333-3333-3333-333333333333',
    fileKey: 'tenants/t1/uploads/PMO_02_RA_Timesheet_Monitoring.xlsx',
    fileName: 'PMO_02_RA_Timesheet_Monitoring.xlsx',
    fileSizeBytes: 123456,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploadedAt: '2026-06-26T05:18:38.000Z',
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    runId: 'run-1',
    planningGoal: 'Ingest workbook',
    requestContext: { get: vi.fn() },
    resumeData: undefined,
    step: baseStep,
    planningPlan: {},
    runtimeContext: {},
    ...overrides,
  };
}

describe('createWorkbookProfilingHandler', () => {
  it('persists profiling summary state when suspending for review', async () => {
    const handler = createWorkbookProfilingHandler({
      getSchemaDetectionResult: async () => ({
        tables: [
          {
            tableId: 'resource_allocation',
            sourceSheet: 'RA',
            headerRow: 1,
            tableConfidence: 0.94,
            mappings: [
              {
                sourceColumn: 'Member ID',
                canonicalField: 'member_id',
                confidence: 0.98,
                evidence: 'header_match',
                status: 'auto_accept',
                scoringBreakdown: {
                  headerSimilarity: 1,
                  valuePattern: 0.8,
                  dataType: 0.7,
                  sheetContext: 0.9,
                  crossSheet: 0.7,
                  llmSemantic: 0,
                },
              },
            ],
            unmappedRequired: [],
            ambiguous: [],
          },
        ],
        validation: {
          status: 'needs_review',
          workbookConfidence: 0.95,
          issues: [],
          tableStatuses: [],
        },
        workbookMeta: {
          sheetCount: 8,
          excludedSheets: ['Notes'],
          totalRows: 240,
        },
      }),
      resolveCardIdentity: () => ({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
      }),
      readPlannerStepMeta: async () => null,
    });

    const result = await handler.execute(makeInput());

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') return;

    expect(result.outputSummary).toMatchObject({
      table_count: 1,
      validation_status: 'needs_review',
      workbook_confidence: 0.95,
    });
    expect(result.runtimeContextPatch?.profiling?.summary).toMatchObject({
      document_count: 1,
      profiled_document_count: 1,
      total_sheet_count: 8,
      total_row_count: 240,
      detected_data_areas: ['resource_allocation'],
      likely_ignorable_sheets: ['Notes'],
    });
    expect(result.runtimeContextPatch?.profiling?.review.status).toBe('needs_review');
    expect(result.runtimeContextPatch?.profiling?.documents[0]).toMatchObject({
      file_name: 'PMO_02_RA_Timesheet_Monitoring.xlsx',
      file_size_bytes: 123456,
      status: 'profiled',
    });
  });

  it('completes on approve resume using the stored profiling proposal', async () => {
    const handler = createWorkbookProfilingHandler({
      getSchemaDetectionResult: async () => {
        throw new Error('should_not_redetect_on_resume');
      },
      resolveCardIdentity: () => ({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
      }),
      readPlannerStepMeta: async () => null,
    });

    const result = await handler.execute(
      makeInput({
        resumeData: { decision: 'approve' },
        runtimeContext: {
          detected_schema: {
            tableMappings: [
              {
                tableId: 'resource_allocation',
                sourceSheet: 'RA',
                headerRow: 1,
                tableConfidence: 0.94,
                mappings: [],
                unmappedRequired: [],
                ambiguous: [],
              },
            ],
            validationStatus: 'needs_review',
            workbookConfidence: 0.95,
            review_proposals: {
              workbook_profiling: [
                {
                  proposal_id: 'proposal-1',
                  version: 1,
                  step_id: 'workbook_profiling',
                  status: 'needs_review',
                  review_required: true,
                  proposal: {
                    tableMappings: [
                      {
                        tableId: 'resource_allocation',
                        sourceSheet: 'RA',
                        headerRow: 1,
                        tableConfidence: 0.94,
                        mappings: [],
                        unmappedRequired: [],
                        ambiguous: [],
                      },
                    ],
                    validationStatus: 'needs_review',
                    workbookConfidence: 0.95,
                  },
                  next_allowed_actions: ['approve', 'reject'],
                  created_by: 'agent',
                  created_at: '2026-06-26T05:18:38.000Z',
                },
              ],
            },
            approved_checkpoints: {},
          },
          profiling: {
            documents: [],
            summary: {
              generated_at: '2026-06-26T05:18:38.000Z',
              document_count: 1,
              profiled_document_count: 1,
              total_sheet_count: 8,
              total_row_count: 240,
              detected_data_areas: ['resource_allocation'],
              missing_recommended_data_areas: [],
              missing_recommended_data_areas_details: [],
              likely_ignorable_sheets: [],
              suggested_next_step:
                'Workbook profiling complete. Confirm sheet roles, then continue to validation.',
            },
            review: {
              status: 'needs_review',
              sheet_overrides: [],
              waived_missing_areas: [],
              last_updated_at: '2026-06-26T05:18:38.000Z',
            },
          },
        },
      }),
    );

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') return;

    expect(result.sessionStatus).toBe('confirmed');
    expect(result.runtimeContextPatch?.profiling?.review).toMatchObject({
      status: 'approved',
      approved_by: '22222222-2222-2222-2222-222222222222',
    });
    expect(result.runtimeContextPatch?.detected_schema?.approved_checkpoints).toBeDefined();
    expect(result.outputSummary).toMatchObject({
      table_count: 1,
      validation_status: 'needs_review',
      workbook_confidence: 0.95,
      checkpoint_version: 1,
    });
  });
});
