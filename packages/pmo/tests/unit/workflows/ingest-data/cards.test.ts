import { describe, expect, it } from 'vitest';
import {
  buildMappingItemReviewCard,
  buildMappingReviewCard,
  buildPublishReviewCard,
  collectMappingReviewItems,
} from '../../../../src/backend/workflows/ingest-data/cards.ts';

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
  it('builds mapping item card with per-item approve progress', () => {
    const reviewItems = collectMappingReviewItems([
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
    ]);

    expect(reviewItems).toHaveLength(3);

    const card = buildMappingItemReviewCard({
      ingestionSessionId: 'f56e9152-7856-44e9-b2d7-4f21d86cdffd',
      workbookConfidence: 0.87,
      validationStatus: 'needs_review',
      reviewItems,
      approvedItemIds: [reviewItems[0]!.id],
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
    });

    const progressTable = kvTables(card.details as unknown[])[0];
    expect(progressTable?.rows.some((row) => row.k === 'Approved items' && row.v === '1/3')).toBe(
      true,
    );
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
});
