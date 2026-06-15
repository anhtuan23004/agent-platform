import { describe, expect, it } from 'vitest';
import type { TableMapping } from '../../src/backend/ingestion/map-columns.ts';
import { validateMapping } from '../../src/backend/ingestion/validate-mapping.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTableMapping(overrides: Partial<TableMapping> = {}): TableMapping {
  return {
    tableId: 'resource_allocation',
    sourceSheet: 'DS01',
    headerRow: 1,
    tableConfidence: 0.95,
    mappings: [],
    unmappedRequired: [],
    ambiguous: [],
    ...overrides,
  };
}

function makeMapping(
  field: string,
  status: 'auto_accept' | 'needs_review' | 'blocked' = 'auto_accept',
) {
  return {
    sourceColumn: `Col_${field}`,
    canonicalField: field,
    confidence: status === 'auto_accept' ? 0.95 : status === 'needs_review' ? 0.75 : 0.4,
    evidence: '',
    status,
    scoringBreakdown: {
      headerSimilarity: 0.9,
      valuePattern: 0.9,
      dataType: 0.9,
      sheetContext: 0.9,
      crossSheet: 0.5,
      llmSemantic: 0.5,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('validateMapping', () => {
  it('all tables high confidence → confirmed', () => {
    const mappings = [
      makeTableMapping({
        tableId: 'resource_allocation',
        tableConfidence: 0.95,
        mappings: [
          makeMapping('member_id'),
          makeMapping('project_id'),
          makeMapping('allocation_pct'),
          makeMapping('start_date'),
          makeMapping('end_date'),
        ],
      }),
      makeTableMapping({
        tableId: 'timesheet',
        tableConfidence: 0.92,
        mappings: [makeMapping('member_id'), makeMapping('work_date'), makeMapping('logged_hours')],
      }),
    ];

    const result = validateMapping(mappings);
    expect(result.status).toBe('confirmed');
    expect(result.issues).toHaveLength(0);
    expect(result.workbookConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('RA missing allocation_pct → blocked', () => {
    const mappings = [
      makeTableMapping({
        tableId: 'resource_allocation',
        unmappedRequired: ['allocation_pct'],
        mappings: [
          makeMapping('member_id'),
          makeMapping('project_id'),
          makeMapping('start_date'),
          makeMapping('end_date'),
        ],
      }),
      makeTableMapping({ tableId: 'timesheet', tableConfidence: 0.9 }),
    ];

    const result = validateMapping(mappings);
    expect(result.status).toBe('blocked');
    expect(
      result.issues.some((i) => i.code === 'MISSING_REQUIRED' && i.field === 'allocation_pct'),
    ).toBe(true);
  });

  it('timesheet has one ambiguous column → needs_review', () => {
    const mappings = [
      makeTableMapping({ tableId: 'resource_allocation', tableConfidence: 0.95 }),
      makeTableMapping({
        tableId: 'timesheet',
        tableConfidence: 0.88,
        ambiguous: ['logged_hours'],
        mappings: [
          makeMapping('member_id'),
          makeMapping('work_date'),
          makeMapping('logged_hours', 'needs_review'),
        ],
      }),
    ];

    const result = validateMapping(mappings);
    expect(result.status).toBe('needs_review');
    expect(result.issues.some((i) => i.code === 'AMBIGUOUS_MAPPING')).toBe(true);
    expect(result.issues.some((i) => i.code === 'LOW_CONFIDENCE')).toBe(true);
  });

  it('member master missing but RA + Timesheet fine → needs_review (core tables present)', () => {
    const mappings = [
      makeTableMapping({ tableId: 'resource_allocation', tableConfidence: 0.95 }),
      makeTableMapping({ tableId: 'timesheet', tableConfidence: 0.9 }),
      // No member_master table
    ];

    const result = validateMapping(mappings);
    // Both core tables present → confirmed (member_master is not core)
    expect(result.status).toBe('confirmed');
  });

  it('blocked mapping (type mismatch) → blocked overall', () => {
    const mappings = [
      makeTableMapping({
        tableId: 'resource_allocation',
        tableConfidence: 0.8,
        mappings: [
          makeMapping('member_id'),
          makeMapping('project_id'),
          makeMapping('allocation_pct', 'blocked'),
          makeMapping('start_date'),
          makeMapping('end_date'),
        ],
      }),
      makeTableMapping({ tableId: 'timesheet', tableConfidence: 0.9 }),
    ];

    const result = validateMapping(mappings);
    expect(result.status).toBe('blocked');
    expect(result.issues.some((i) => i.code === 'TYPE_MISMATCH')).toBe(true);
  });

  it('missing core table (timesheet) → needs_review', () => {
    const mappings = [
      makeTableMapping({ tableId: 'resource_allocation', tableConfidence: 0.95 }),
      // Timesheet not detected
    ];

    const result = validateMapping(mappings);
    expect(result.status).toBe('needs_review');
    expect(
      result.issues.some((i) => i.code === 'CORE_TABLE_MISSING' && i.tableId === 'timesheet'),
    ).toBe(true);
  });

  it('low table confidence → needs_review with warning', () => {
    const mappings = [
      makeTableMapping({ tableId: 'resource_allocation', tableConfidence: 0.55 }),
      makeTableMapping({ tableId: 'timesheet', tableConfidence: 0.9 }),
    ];

    const result = validateMapping(mappings);
    expect(result.status).toBe('needs_review');
    expect(result.issues.some((i) => i.code === 'LOW_TABLE_CONFIDENCE')).toBe(true);
  });

  it('computes workbook confidence as average of table confidences', () => {
    const mappings = [
      makeTableMapping({ tableId: 'resource_allocation', tableConfidence: 0.9 }),
      makeTableMapping({ tableId: 'timesheet', tableConfidence: 0.8 }),
    ];

    const result = validateMapping(mappings);
    expect(result.workbookConfidence).toBeCloseTo(0.85, 2);
  });
});
