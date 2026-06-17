import { describe, expect, it } from 'vitest';
import { normalizeProfilingSummaryForTests } from '../../../src/backend/http/routes.ts';

describe('profiling summary normalization (legacy compatibility)', () => {
  it('maps legacy holiday to calendar_weeks and drops unsupported legacy areas', () => {
    const normalized = normalizeProfilingSummaryForTests({
      generated_at: '2026-06-15T00:00:00.000Z',
      document_count: 1,
      profiled_document_count: 1,
      total_sheet_count: 10,
      total_row_count: 100,
      detected_data_areas: ['resource_allocation', 'holiday', 'training', 'unknown'],
      missing_recommended_data_areas: ['holiday', 'training', 'kpi_norms'],
      missing_recommended_data_areas_details: [
        {
          data_area: 'holiday',
          source: 'goal_rule',
          reason: 'Legacy holiday area detected.',
          confidence: 'medium',
        },
        {
          data_area: 'training',
          source: 'llm_interpretation',
          reason: 'Legacy training area should be ignored.',
          confidence: 'medium',
        },
      ],
      likely_ignorable_sheets: ['LEGEND & SUMMARY', 'Answer_Key'],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.detected_data_areas).toEqual(
      expect.arrayContaining(['resource_allocation', 'calendar_weeks']),
    );
    expect(normalized?.detected_data_areas).not.toContain('training');

    expect(normalized?.missing_recommended_data_areas).toEqual([]);
    expect(normalized?.missing_recommended_data_areas_details).toEqual([]);
    expect(normalized?.suggested_next_step).toBe(
      'Workbook profiling complete. Confirm sheet roles, then continue to validation.',
    );
  });

  it('clears legacy missing recommendations because profiling only checks sheet-role structure', () => {
    const normalized = normalizeProfilingSummaryForTests({
      generated_at: '2026-06-15T00:00:00.000Z',
      document_count: 1,
      profiled_document_count: 1,
      total_sheet_count: 8,
      total_row_count: 200,
      detected_data_areas: ['resource_allocation', 'timesheet'],
      missing_recommended_data_areas: ['kpi_norms'],
      missing_recommended_data_areas_details: [
        {
          data_area: 'kpi_norms',
          source: 'goal_rule',
          reason: 'Reference sheet is optional.',
          confidence: 'low',
        },
      ],
      likely_ignorable_sheets: [],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.missing_recommended_data_areas).toEqual([]);
    expect(normalized?.suggested_next_step).toBe(
      'Workbook profiling complete. Confirm sheet roles, then continue to validation.',
    );
  });
});
