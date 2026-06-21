import { appendCheckpoint, approveProposal, createProposal } from '@seta/ingestion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbChangeSummaryResult } from '../../../../src/backend/workflows/ingest-data-v2/handlers/common.ts';
import { createGenerateReportHandler } from '../../../../src/backend/workflows/ingest-data-v2/handlers/generate-report.ts';
import type { PmoDynamicHandlerInput } from '../../../../src/backend/workflows/ingest-data-v2/types.ts';

const mockGenerateReport = vi.fn(async () => ({
  reportRunId: '44444444-4444-4444-4444-444444444444',
  report: {
    dateRange: { from: '2026-06-01', to: '2026-06-30' },
    sourceVersion: {
      factsVersion: 'facts-v1',
      canonicalDataVersion: 'canonical-v1',
      factsComputedAt: '2026-06-30T00:00:00.000Z',
    },
    summary: {
      memberCount: 2,
      overbookCount: 1,
      idleCount: 1,
      excludedWeekCount: 0,
    },
    members: [],
    findings: [],
    recommendations: [],
  },
}));

const baseStep = {
  step_no: 5,
  planner_step_id: 'pmo.planner.step.5.generate_report',
  action_id: 'generate_report',
  review_type: 'report',
  step_name: 'Generate PMO report',
  status: 'in_progress',
} as const;

const dbChangeResult: DbChangeSummaryResult = {
  changeSummary: [],
  blockingIssues: [],
  mappingReviewRows: [],
  hasBlockingIssues: false,
  hasUpdates: true,
  requiresReview: true,
};

function approvedStagingResult() {
  const proposal = createProposal<DbChangeSummaryResult>({
    state: {},
    stepId: 'database_change_summary',
    proposal: dbChangeResult,
    status: 'needs_review',
    reviewRequired: true,
    nextAllowedActions: ['approve', 'reject'],
    createdBy: 'agent',
    proposalId: 'db-change-proposal-1',
    createdAt: '2026-06-17T00:00:00.000Z',
  });
  const checkpoint = approveProposal({
    proposal,
    approvedOutput: dbChangeResult,
    approvedBy: 'user-1',
    checkpointId: 'db-change-checkpoint-1',
    approvedAt: '2026-06-17T00:01:00.000Z',
  });

  return {
    ...dbChangeResult,
    ...appendCheckpoint({}, checkpoint),
  };
}

const deps = {
  resolveCardIdentity: () => ({
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
  }),
  readPlannerStepMeta: async () => null,
  generateReport: mockGenerateReport,
  getWorkbookParseResult: async () => ({
    sheets: [
      {
        name: 'Timesheets',
        rowCount: 2,
        colCount: 2,
        headerRow: 1,
        headers: ['Work Date', 'Member'],
        columns: [],
        rows: [
          { 'Work Date': '2026-06-01', Member: 'EMP-001' },
          { 'Work Date': '2026-06-30', Member: 'EMP-002' },
        ],
        sampleDataRows: [],
        warnings: [],
      },
    ],
    excludedSheets: [],
    parseErrors: [],
  }),
  getReportDateBounds: async () => ({ min: '2026-01-01', max: '2026-12-31' }),
} satisfies Parameters<typeof createGenerateReportHandler>[0];

function makeInput(overrides: Partial<PmoDynamicHandlerInput> = {}): PmoDynamicHandlerInput {
  return {
    ingestionSessionId: '33333333-3333-3333-3333-333333333333',
    fileKey: 'tenant/file.xlsx',
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    runId: 'run-1',
    planningGoal: 'Publish and generate idle/overbook report',
    requestContext: { get: () => undefined },
    resumeData: undefined,
    step: baseStep,
    planningPlan: null,
    reportSource: 'published_batch',
    runtimeContext: {
      staging_result: approvedStagingResult(),
      confirmed_mapping: {
        confirmedMappings: [
          {
            tableId: 'timesheet',
            sourceSheet: 'Timesheets',
            mappings: [{ canonicalField: 'work_date', sourceColumn: 'Work Date' }],
          },
        ],
        mappingReviewRows: [],
      },
    },
    ...overrides,
  };
}

describe('createGenerateReportHandler', () => {
  beforeEach(() => {
    mockGenerateReport.mockClear();
  });

  it('suspends for confirmation with published-batch sheet dates as the suggestion', async () => {
    const result = await createGenerateReportHandler(deps).execute(makeInput());

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.card.primary.argsPatch).toMatchObject({
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
      dateRangeStrategy: 'sheet_derived',
      rangeSource: 'sheet_or_database',
    });
    expect(result.runtimeContextPatch?.report_request).toMatchObject({
      dateRange: {
        from: '2026-06-01',
        to: '2026-06-30',
        source: 'sheet_suggested_pending',
      },
    });
    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it('generates the report after the user confirms a date range', async () => {
    const result = await createGenerateReportHandler(deps).execute(
      makeInput({
        resumeData: {
          decision: 'approve',
          dateRange: { from: '2026-06-01', to: '2026-06-30' },
        },
      }),
    );

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') throw new Error('expected completed');
    expect(mockGenerateReport).toHaveBeenCalledWith({
      tenantId: '11111111-1111-1111-1111-111111111111',
      actorId: '22222222-2222-2222-2222-222222222222',
      sourceMode: 'after_upload_publish',
      ingestionSessionId: '33333333-3333-3333-3333-333333333333',
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
      reportTypes: ['idle_members', 'overbook_members'],
    });
    expect(result.runtimeContextPatch?.report_result?.summary).toMatchObject({
      overbookCount: 1,
      idleCount: 1,
    });
    expect(result.outputSummary?.report_run_id).toBe('44444444-4444-4444-4444-444444444444');
    expect(result.terminalOutput?.report).toBeDefined();
  });

  it('uses classifier-extracted dates before derived ranges', async () => {
    const result = await createGenerateReportHandler(deps).execute(
      makeInput({
        planningPlan: {
          intent_analysis: {
            dataSourceMode: 'uploaded_file',
            actionMode: 'publish_then_report',
            extractedDateRange: { from: '2026-06-05', to: '2026-06-20' },
            extractedReportTypes: ['idle_members', 'overbook_members'],
          },
        },
      }),
    );

    expect(result.kind).toBe('completed');
    expect(mockGenerateReport).toHaveBeenCalledWith(
      expect.objectContaining({ dateRange: { from: '2026-06-05', to: '2026-06-20' } }),
    );
  });

  it('runs a database-only report without requiring a publish checkpoint', async () => {
    const result = await createGenerateReportHandler({
      ...deps,
      getReportDateBounds: vi.fn().mockResolvedValue({
        min: '2026-01-01',
        max: '2026-12-31',
      }),
    }).execute(
      makeInput({
        planningPlan: {
          intent_analysis: {
            dataSourceMode: 'existing_db',
            actionMode: 'generate_report',
            extractedDateRange: { from: '2026-06-01', to: '2026-06-30' },
            extractedReportTypes: ['idle_members', 'overbook_members'],
          },
        },
        reportSource: 'canonical_db',
        runtimeContext: {},
      }),
    );

    expect(result.kind).toBe('completed');
    expect(mockGenerateReport).toHaveBeenCalledWith(
      expect.objectContaining({ dateRange: { from: '2026-06-01', to: '2026-06-30' } }),
    );
  });

  it('offers database bounds when a database-only report has no explicit range', async () => {
    const result = await createGenerateReportHandler({
      ...deps,
      getReportDateBounds: vi.fn().mockResolvedValue({
        min: '2026-02-01',
        max: '2026-11-30',
      }),
    }).execute(
      makeInput({
        planningPlan: {
          intent_analysis: {
            dataSourceMode: 'existing_db',
            actionMode: 'generate_report',
            extractedReportTypes: ['idle_members'],
          },
        },
        reportSource: 'canonical_db',
        runtimeContext: {},
      }),
    );

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.card.primary.argsPatch).toMatchObject({
      dateRange: { from: '2026-02-01', to: '2026-11-30' },
      dateRangeStrategy: 'manual_database',
    });
    expect(JSON.stringify(result.card.details)).toContain('2026-02-01');
    expect(JSON.stringify(result.card.details)).toContain('2026-11-30');
  });

  it('rejects deprecated staging-preview report source', async () => {
    await expect(
      createGenerateReportHandler(deps).execute(
        makeInput({ reportSource: 'staging_preview', runtimeContext: {} }),
      ),
    ).rejects.toThrow('report_staging_preview_not_supported');
    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it('rejects an LLM-extracted range outside the tenant database bounds', async () => {
    await expect(
      createGenerateReportHandler({
        ...deps,
        getReportDateBounds: vi.fn().mockResolvedValue({
          min: '2026-02-01',
          max: '2026-11-30',
        }),
      }).execute(
        makeInput({
          planningPlan: {
            intent_analysis: {
              dataSourceMode: 'existing_db',
              actionMode: 'generate_report',
              extractedDateRange: { from: '2026-01-01', to: '2026-12-31' },
              extractedReportTypes: ['idle_members'],
            },
          },
          reportSource: 'canonical_db',
          runtimeContext: {},
        }),
      ),
    ).rejects.toThrow('report_date_range_outside_database_bounds');
  });
});
