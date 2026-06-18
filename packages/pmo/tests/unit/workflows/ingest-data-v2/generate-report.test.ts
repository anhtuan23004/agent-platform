import { appendCheckpoint, approveProposal, createProposal } from '@seta/ingestion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePmoReport } from '../../../../src/backend/analytics/report.ts';
import type { DbChangeSummaryResult } from '../../../../src/backend/workflows/ingest-data-v2/handlers/common.ts';
import { createGenerateReportHandler } from '../../../../src/backend/workflows/ingest-data-v2/handlers/generate-report.ts';
import type { PmoDynamicHandlerInput } from '../../../../src/backend/workflows/ingest-data-v2/types.ts';

vi.mock('../../../../src/backend/analytics/report.ts', () => ({
  generatePmoReport: vi.fn(async () => ({
    dateRange: { from: '2026-06-01', to: '2026-06-30' },
    summary: {
      memberCount: 2,
      overbookCount: 1,
      idleCount: 1,
      excludedWeekCount: 0,
    },
    findings: [],
  })),
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
  persistReportRun: vi.fn(async () => '44444444-4444-4444-4444-444444444444'),
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
    vi.mocked(generatePmoReport).mockClear();
    deps.persistReportRun.mockClear();
  });

  it('suspends for date range confirmation when the goal has no explicit range', async () => {
    const result = await createGenerateReportHandler(deps).execute(makeInput());

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.sessionStatus).toBe('awaiting_report_range');
    expect(result.runtimeContextPatch?.report_request?.dateRange).toMatchObject({
      from: '2026-06-01',
      to: '2026-06-30',
      source: 'sheet_suggested_pending',
    });
    expect(result.card.primary.argsPatch).toMatchObject({
      decision: 'approve',
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
    });
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
    expect(generatePmoReport).toHaveBeenCalledWith({
      tenantId: '11111111-1111-1111-1111-111111111111',
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
});
