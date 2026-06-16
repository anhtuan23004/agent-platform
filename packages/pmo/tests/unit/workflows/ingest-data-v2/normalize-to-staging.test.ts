import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestionDomainAdapter } from '../../../../src/backend/ingestion/domain-adapter.ts';
import type { ParsedSheet } from '../../../../src/backend/ingestion/parse-workbook.ts';
import { PMO_DOMAIN_CONFIG } from '../../../../src/backend/ingestion/pmo-domain-config.ts';
import { createNormalizeToStagingHandler } from '../../../../src/backend/workflows/ingest-data-v2/handlers/normalize-to-staging.ts';
import type { PmoDynamicHandlerInput } from '../../../../src/backend/workflows/ingest-data-v2/types.ts';

const dbMock = vi.hoisted(() => {
  let selectResults: Array<Array<{ id: string }>> = [];

  return {
    setSelectResults(results: Array<Array<{ id: string }>>) {
      selectResults = [...results];
    },
    pmoDb: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
  };
});

vi.mock('../../../../src/backend/db/client.ts', () => ({
  pmoDb: dbMock.pmoDb,
}));

const baseStep = {
  step_no: 3,
  planner_step_id: 'pmo.planner.step.3.normalize_to_staging',
  action_id: 'normalize_to_staging',
  review_type: 'normalization',
  step_name: 'Normalize and validate data quality',
  status: 'in_progress',
} as const;

function sheet(name: string, rows: Record<string, string>[]): ParsedSheet {
  const headers = Object.keys(rows[0] ?? {});
  return {
    name,
    rowCount: rows.length + 1,
    colCount: headers.length,
    headerRow: 1,
    headers,
    columns: headers.map((header, index) => ({
      index: index + 1,
      name: header,
      sampleValues: rows
        .map((row) => row[header] ?? '')
        .filter(Boolean)
        .slice(0, 10),
      nonEmptyCount: rows.filter((row) => (row[header] ?? '').trim() !== '').length,
      totalRowCount: rows.length,
    })),
    rows,
    sampleDataRows: rows.slice(0, 5),
    warnings: [],
  };
}

const deps = {
  domainConfig: PMO_DOMAIN_CONFIG,
  domainAdapter: {
    domainId: 'pmo',
    findReferenceValues: vi.fn(async ({ tableId }) => {
      if (tableId === 'project_master') return new Set(['p-001']);
      return new Set<string>();
    }),
    findActiveRecords: vi.fn(async () => []),
    publish: vi.fn(async () => ({
      rowsWritten: {},
      rowsUpdated: {},
      rowsSkipped: {},
    })),
  } satisfies IngestionDomainAdapter,
  resolveCardIdentity: () => ({
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
  }),
  readPlannerStepMeta: async () => null,
  requiredFieldsByTable: new Map([
    [
      'resource_allocation',
      ['member_id', 'project_id', 'allocation_pct', 'start_date', 'end_date'],
    ],
    ['member_master', ['member_id', 'full_name']],
    ['project_master', ['project_id', 'project_name']],
  ]),
  getWorkbookParseResult: async () => ({
    sheets: [
      sheet('RA', [
        {
          Member_ID: 'M-404',
          Project_ID: 'P-001',
          Allocation: '50%',
          Start: '2026-06-01',
          End: '2026-06-30',
        },
      ]),
    ],
    excludedSheets: [],
    parseErrors: [],
  }),
} satisfies Parameters<typeof createNormalizeToStagingHandler>[0];

function makeInput(overrides: Partial<PmoDynamicHandlerInput> = {}): PmoDynamicHandlerInput {
  return {
    ingestionSessionId: '33333333-3333-3333-3333-333333333333',
    fileKey: 'tenant/file.xlsx',
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    runId: 'run-1',
    requestContext: { get: () => undefined },
    resumeData: undefined,
    step: baseStep,
    planningPlan: null,
    runtimeContext: {
      confirmed_mapping: {
        mappingReviewRows: [],
        confirmedMappings: [
          {
            tableId: 'resource_allocation',
            sourceSheet: 'RA',
            headerRow: 1,
            tableConfidence: 1,
            mappings: [
              { sourceColumn: 'Member_ID', canonicalField: 'member_id', confidence: 1 },
              { sourceColumn: 'Project_ID', canonicalField: 'project_id', confidence: 1 },
              { sourceColumn: 'Allocation', canonicalField: 'allocation_pct', confidence: 1 },
              { sourceColumn: 'Start', canonicalField: 'start_date', confidence: 1 },
              { sourceColumn: 'End', canonicalField: 'end_date', confidence: 1 },
            ],
            unmappedRequired: [],
            ambiguous: [],
          },
        ],
      },
    },
    ...overrides,
  };
}

describe('createNormalizeToStagingHandler', () => {
  beforeEach(() => {
    dbMock.pmoDb.mockClear();
    vi.mocked(deps.domainAdapter.findReferenceValues).mockClear();
    vi.mocked(deps.domainAdapter.findActiveRecords).mockClear();
  });

  it('blocks staging when RA member_id is absent from upload member master and DB member master', async () => {
    const result = await createNormalizeToStagingHandler(deps).execute(makeInput());

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.card.primary.label).toBe('Reject blocked normalization');
    expect(result.outputSummary).toMatchObject({ status: 'needs_review', blocking_issues: 1 });
    expect(result.runtimeContextPatch?.staging_result?.blockingIssues).toEqual([
      expect.objectContaining({
        tableId: 'resource_allocation',
        sourceRow: 2,
        field: 'member_id',
        reason: expect.stringContaining('unresolved reference'),
      }),
    ]);
  });

  it('allows normalization approval when RA member_id is present in uploaded member master', async () => {
    const result = await createNormalizeToStagingHandler({
      ...deps,
      getWorkbookParseResult: async () => ({
        sheets: [
          sheet('RA', [
            {
              Member_ID: 'M-001',
              Project_ID: 'P-001',
              Allocation: '50%',
              Start: '2026-06-01',
              End: '2026-06-30',
            },
          ]),
          sheet('Members', [{ Member_ID: 'M-001', Full_Name: 'An Nguyen' }]),
        ],
        excludedSheets: [],
        parseErrors: [],
      }),
    }).execute(
      makeInput({
        runtimeContext: {
          confirmed_mapping: {
            mappingReviewRows: [],
            confirmedMappings: [
              ...(makeInput().runtimeContext.confirmed_mapping?.confirmedMappings ?? []),
              {
                tableId: 'member_master',
                sourceSheet: 'Members',
                headerRow: 1,
                tableConfidence: 1,
                mappings: [
                  { sourceColumn: 'Member_ID', canonicalField: 'member_id', confidence: 1 },
                  { sourceColumn: 'Full_Name', canonicalField: 'full_name', confidence: 1 },
                ],
                unmappedRequired: [],
                ambiguous: [],
              },
            ],
          },
        },
      }),
    );

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('expected suspend');
    expect(result.card.primary.label).toBe('Approve normalization');
    expect(result.outputSummary).toMatchObject({ status: 'needs_review', blocking_issues: 0 });
    expect(result.runtimeContextPatch?.staging_result?.blockingIssues).toEqual([]);
  });
});
