import { describe, expect, it } from 'vitest';
import {
  buildMappingItemReviewCard,
  buildMappingReviewCard,
  buildNormalizationReviewCard,
  buildPublishReviewCard,
  buildReportRangeCard,
  collectMappingReviewItems,
} from '../../../../src/backend/workflows/ingest-data-v2/cards.ts';

interface KvTableBlock {
  kind: 'kvTable';
  rows: Array<{ k: string; v: string }>;
}

function kvTables(details: unknown[]): KvTableBlock[] {
  return details.filter(
    (block): block is KvTableBlock =>
      !!block &&
      typeof block === 'object' &&
      (block as { kind?: unknown }).kind === 'kvTable' &&
      Array.isArray((block as { rows?: unknown }).rows),
  );
}

describe('PMO ingest review cards', () => {
  it('keeps normalization card layout while framing validate outcome correctly', () => {
    const card = buildNormalizationReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      changeSummary: [],
      blockingIssues: [],
      allowApprove: true,
      focus: 'validation',
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_reviewNormalization',
    });

    expect(card.intent).toBe('Review workbook validation results');
    expect(card.primary.label).toBe('Complete validation');
    expect(card.details.some((detail) => detail.kind === 'kvTable')).toBe(true);
  });

  it('builds mapping item card with per-item approve progress', () => {
    const tableMappings = [
      {
        tableId: 'resource_allocation',
        sourceSheet: 'DS01',
        headerRow: 1,
        tableConfidence: 0.81,
        mappings: [
          {
            sourceColumn: 'Role',
            canonicalField: 'role',
            confidence: 0.74,
            status: 'needs_review',
          },
        ],
        unmappedRequired: ['start_date'],
        ambiguous: ['end_date'],
      },
    ] satisfies Parameters<typeof collectMappingReviewItems>[0];
    const reviewItems = collectMappingReviewItems(tableMappings);

    expect(reviewItems).toHaveLength(3);

    const card = buildMappingItemReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      workbookConfidence: 0.87,
      validationStatus: 'needs_review',
      tableMappings,
      reviewItems,
      approvedItemIds: [reviewItems[0]!.id],
      approvedByByItemKey: { [reviewItems[0]!.id]: 'user-1' },
      mappingOverrides: [],
      currentItemId: reviewItems[1]!.id,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmMapping',
    });

    expect(card.summary).toContain('2/3');
    expect(card.primary.label).toContain('2/3');
    expect(card.primary.argsPatch).toEqual({
      decision: 'approve',
      approvedItemKey: reviewItems[1]!.id,
      approvedItemKeys: [reviewItems[0]!.id],
      approvedByByItemKey: { [reviewItems[0]!.id]: 'user-1' },
      mappingOverrides: [],
    });

    const progressTable = kvTables(card.details as unknown[])[0];
    expect(progressTable?.rows.some((row) => row.k === 'Approved items' && row.v === '1/3')).toBe(
      true,
    );
  });

  it('emits mapping alternates for direct modify flow', () => {
    const tableMappings = [
      {
        tableId: 'overbook_idle_config',
        sourceSheet: 'Config',
        headerRow: 1,
        tableConfidence: 0.88,
        mappings: [
          {
            sourceColumn: 'Overbook_threshold',
            canonicalField: 'overbook_threshold',
            confidence: 0.94,
            status: 'needs_review',
            candidates: [
              { sourceColumn: 'Overbook_threshold', confidence: 0.94, blocked: false },
              { sourceColumn: 'Overbook Limit', confidence: 0.82, blocked: false },
            ],
          },
        ],
        unmappedRequired: [],
        ambiguous: [],
      },
    ] satisfies Parameters<typeof collectMappingReviewItems>[0];
    const reviewItems = collectMappingReviewItems(tableMappings);

    const card = buildMappingItemReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      workbookConfidence: 0.91,
      validationStatus: 'needs_review',
      tableMappings,
      reviewItems,
      approvedItemIds: [],
      approvedByByItemKey: {},
      mappingOverrides: [],
      currentItemId: reviewItems[0]!.id,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmMapping',
    });

    expect(card.alternates).toHaveLength(1);
    expect(card.alternates[0]?.argsPatch).toMatchObject({
      decision: 'modify',
      approvedByByItemKey: {},
      mappingOverride: {
        tableId: 'overbook_idle_config',
        field: 'overbook_threshold',
        sourceColumn: 'Overbook Limit',
      },
    });
  });

  it('includes auto_accept mappings in list with modify-only action', () => {
    const tableMappings = [
      {
        tableId: 'resource_allocation',
        sourceSheet: 'DS01',
        headerRow: 1,
        tableConfidence: 0.9,
        mappings: [
          {
            sourceColumn: 'Member ID',
            canonicalField: 'member_id',
            confidence: 0.98,
            status: 'auto_accept',
            candidates: [
              { sourceColumn: 'Member ID', confidence: 0.98, blocked: false },
              { sourceColumn: 'MemberId', confidence: 0.91, blocked: false },
            ],
          },
          {
            sourceColumn: 'Role',
            canonicalField: 'role',
            confidence: 0.74,
            status: 'needs_review',
            candidates: [
              { sourceColumn: 'Role', confidence: 0.74, blocked: false },
              { sourceColumn: 'Role Name', confidence: 0.69, blocked: false },
            ],
          },
        ],
        unmappedRequired: [],
        ambiguous: [],
      },
    ] satisfies Parameters<typeof collectMappingReviewItems>[0];
    const reviewItems = collectMappingReviewItems(tableMappings);

    const card = buildMappingItemReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      workbookConfidence: 0.91,
      validationStatus: 'needs_review',
      tableMappings,
      reviewItems,
      approvedItemIds: [],
      approvedByByItemKey: {},
      mappingOverrides: [],
      currentItemId: reviewItems[0]!.id,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmMapping',
    });

    const tables = kvTables(card.details as unknown[]);
    const progressRows = tables[tables.length - 1]?.rows ?? [];
    const autoRow = progressRows.find((row) => row.k === 'resource_allocation.member_id');

    expect(autoRow?.v).toContain('auto_accept');
    expect(autoRow?.v).toContain('modify_only');
    expect(
      card.alternates.some(
        (alternate) =>
          (alternate.argsPatch?.mappingOverride as { field?: string } | undefined)?.field ===
          'member_id',
      ),
    ).toBe(true);
  });

  it('builds final next-step gate card after all mapping items are approved', () => {
    const tableMappings = [
      {
        tableId: 'resource_allocation',
        sourceSheet: 'DS01',
        headerRow: 1,
        tableConfidence: 0.91,
        mappings: [
          {
            sourceColumn: 'Role',
            canonicalField: 'role',
            confidence: 0.88,
            status: 'needs_review',
          },
        ],
        unmappedRequired: [],
        ambiguous: [],
      },
    ] satisfies Parameters<typeof collectMappingReviewItems>[0];
    const reviewItems = collectMappingReviewItems(tableMappings);

    const itemId = reviewItems[0]!.id;
    const card = buildMappingItemReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      workbookConfidence: 0.91,
      validationStatus: 'needs_review',
      tableMappings,
      reviewItems,
      approvedItemIds: [itemId],
      approvedByByItemKey: { [itemId]: 'user-1' },
      mappingOverrides: [],
      currentItemId: itemId,
      awaitingNextStep: true,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmMapping',
    });

    expect(card.primary.label).toBe('Next step');
    expect(card.primary.argsPatch).toMatchObject({
      decision: 'approve',
      approvedItemKeys: [itemId],
      proceedToNextStep: true,
      approvedByByItemKey: { [itemId]: 'user-1' },
    });
  });

  it('dedupes ambiguous and needs_review issues for the same field', () => {
    const reviewItems = collectMappingReviewItems([
      {
        tableId: 'overbook_idle_config',
        sourceSheet: 'Config',
        headerRow: 1,
        tableConfidence: 0.86,
        mappings: [
          {
            sourceColumn: 'Overbook Threshold',
            canonicalField: 'overbook_threshold',
            confidence: 0.78,
            status: 'needs_review',
          },
        ],
        unmappedRequired: [],
        ambiguous: ['overbook_threshold'],
      },
    ]);

    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0]?.issueType).toBe('ambiguous');
    expect(reviewItems[0]?.sourceColumn).toBe('Overbook Threshold');
    expect(reviewItems[0]?.note).toContain('ambiguous mapping candidates');
    expect(reviewItems[0]?.note).toContain('Overbook Threshold');
  });

  it('includes per-field mapping issues in mapping review card details', () => {
    const card = buildMappingReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      workbookConfidence: 0.87,
      validationStatus: 'blocked',
      allowApprove: false,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmMapping',
      tableMappings: [
        {
          tableId: 'resource_allocation',
          sourceSheet: 'DS01',
          headerRow: 1,
          tableConfidence: 0.81,
          mappings: [
            {
              sourceColumn: 'Role',
              canonicalField: 'role',
              confidence: 0.74,
              status: 'needs_review',
            },
            {
              sourceColumn: 'Allocation',
              canonicalField: 'allocation_pct',
              confidence: 0.3,
              status: 'blocked',
            },
          ],
          unmappedRequired: ['start_date'],
          ambiguous: ['end_date'],
        },
      ],
    });

    const tables = kvTables(card.details as unknown[]);
    const issueRows = tables.flatMap((table) => table.rows);

    expect(issueRows.some((row) => row.k === 'resource_allocation.role')).toBe(true);
    expect(issueRows.some((row) => row.k === 'resource_allocation.start_date')).toBe(true);
    expect(issueRows.some((row) => row.k === 'resource_allocation.end_date')).toBe(true);

    const checklist = (card.details as Array<{ kind: string; body?: string }>).find(
      (block) => block.kind === 'text',
    );
    expect(checklist?.body).toContain('Reject this run');
  });

  it('includes blocking data issues in publish review card details', () => {
    const card = buildPublishReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      allowApprove: false,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmPublish',
      changeSummary: [
        {
          tableId: 'resource_allocation',
          counts: {
            new_records: 1,
            updated_records: 2,
            exact_duplicates: 0,
            duplicates_in_upload: 0,
          },
          sampleChanges: [
            {
              type: 'updated_record',
              naturalKey: {
                member_id: 'EMP-001',
                project_id: 'PRJ-001',
              },
              newValues: { allocation_pct: 0.8 },
            },
          ],
        },
      ],
      blockingIssues: [
        {
          tableId: 'resource_allocation',
          sourceRow: 7,
          field: 'member_id',
          reason: 'required value missing after normalization',
        },
      ],
    });

    expect(card.summary).toContain('blocking data issue');

    const tables = kvTables(card.details as unknown[]);
    const rows = tables.flatMap((table) => table.rows);

    expect(rows.some((row) => row.k === 'Blocking issues' && row.v === '1')).toBe(true);
    expect(rows.some((row) => row.k.includes('resource_allocation row 7 member_id'))).toBe(true);
  });

  it('describes publish preview as incremental upsert and existing-row skips', () => {
    const card = buildPublishReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      allowApprove: true,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmPublish',
      changeSummary: [
        {
          tableId: 'resource_allocation',
          counts: {
            new_records: 1,
            updated_records: 2,
            exact_duplicates: 3,
            duplicates_in_upload: 0,
          },
          sampleChanges: [],
        },
      ],
      blockingIssues: [],
    });

    const tables = kvTables(card.details as unknown[]);
    const rows = tables.flatMap((table) => table.rows);

    expect(card.summary).toContain('Ready to publish 3 change');
    expect(rows.some((row) => row.k === 'Rows to publish' && row.v === '3')).toBe(true);
    expect(rows.some((row) => row.k === 'Rows to skip' && row.v === '3')).toBe(true);
    expect(rows.some((row) => row.k === 'Skip reason')).toBe(true);
    expect(rows.some((row) => /duplicate-in-upload/i.test(`${row.k} ${row.v}`))).toBe(false);
  });

  it('builds report range confirmation card with suggested date range payload', () => {
    const card = buildReportRangeCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      suggestedWorkloadDateRange: { from: '2026-06-01', to: '2026-06-30' },
      suggestedForwardAllocationDateRange: null,
      databaseDateBounds: { min: '2026-01-01', max: '2026-12-31' },
      rangeSource: 'sheet_or_database',
      reportTypes: ['idle_members', 'overbook_members'],
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmReportRange',
    });

    expect(card.intent).toBe('Confirm PMO report date range');
    expect(card.primary.argsPatch).toMatchObject({
      decision: 'approve',
      workloadDateRange: { from: '2026-06-01', to: '2026-06-30' },
      dateRangeStrategy: 'sheet_derived',
      databaseDateBounds: { min: '2026-01-01', max: '2026-12-31' },
      rangeSource: 'sheet_or_database',
    });
    expect(JSON.stringify(card.details)).toContain('2026-06-01');
    expect(JSON.stringify(card.details)).toContain('2026-06-30');
  });

  it('labels forward allocation reports explicitly in the range card', () => {
    const card = buildReportRangeCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      suggestedWorkloadDateRange: { from: '2026-08-01', to: '2026-08-31' },
      suggestedForwardAllocationDateRange: { from: '2026-09-01', to: '2026-10-26' },
      databaseDateBounds: { min: '2026-01-01', max: '2026-12-31' },
      rangeSource: 'sheet_or_database',
      reportTypes: ['forward_allocation'],
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmReportRange',
    });

    expect(JSON.stringify(card.details)).toContain('Forward allocation');
  });

  it('separates workload and forward allocation sections inside the same range card', () => {
    const card = buildReportRangeCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      suggestedWorkloadDateRange: { from: '2026-08-01', to: '2026-08-31' },
      suggestedForwardAllocationDateRange: { from: '2026-09-01', to: '2026-10-26' },
      databaseDateBounds: { min: '2026-01-01', max: '2026-12-31' },
      rangeSource: 'sheet_or_database',
      reportTypes: ['idle_members', 'forward_allocation'],
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      toolCallId: 'workflow:test:pmo_confirmReportRange',
    });

    expect(card.primary.argsPatch).toMatchObject({
      reportSections: [
        expect.objectContaining({ kind: 'workload', title: 'Workload report' }),
        expect.objectContaining({
          kind: 'forward_allocation',
          title: 'Forward allocation report',
        }),
      ],
    });
    expect(JSON.stringify(card.details)).toContain('Workload report');
    expect(JSON.stringify(card.details)).toContain('Forward allocation report');
  });
});
