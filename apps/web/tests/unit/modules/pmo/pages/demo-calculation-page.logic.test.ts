import { describe, expect, it } from 'vitest';
import type { PmoPlanningSession } from '../../../../../src/modules/pmo/api/client';
import {
  buildSourceUploadOptions,
  hasCustomDateRange,
  utilizationEmptyState,
} from '../../../../../src/modules/pmo/pages/demo-calculation-page.logic';

function session(overrides: Partial<PmoPlanningSession> = {}): PmoPlanningSession {
  return {
    ingestion_session_id: '00000000-0000-0000-0000-000000000001',
    source_kind: 'workbook',
    workbook_name: 'PMO June.xlsx',
    workbook_size_bytes: 1234,
    workbook_size: '1.2 KB',
    file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploaded_at: '2026-06-19T00:00:00.000Z',
    operator: '00000000-0000-0000-0000-000000000002',
    status: 'published',
    is_published: true,
    is_selectable: true,
    reporting_period_key: '2026-W26',
    reporting_period_start: '2026-06-29T00:00:00.000Z',
    reporting_period_end: '2026-07-03T00:00:00.000Z',
    planning_state: 'approved_plan',
    status_label: 'Execution completed',
    active_gate: 'All workflow steps completed',
    progress_text: '6 / 6 workflow steps',
    progress_pct: 100,
    goal: '',
    intent: null,
    plan: null,
    plan_version: 0,
    feedback_history: [],
    execution_state: null,
    profiling_documents: [],
    profiling_summary: null,
    profiling_review: null,
    workflow_current_step: null,
    workflow_step_status: null,
    workflow_started_at: null,
    workflow_updated_at: null,
    plan_generated_at: null,
    plan_approved_at: null,
    ...overrides,
  };
}

describe('demo calculation page logic', () => {
  it('builds source upload options with period metadata and disabled unpublished uploads', () => {
    const options = buildSourceUploadOptions([
      session(),
      session({
        ingestion_session_id: '00000000-0000-0000-0000-000000000003',
        status: 'awaiting_publish_review',
        is_published: false,
        is_selectable: false,
        status_label: 'Awaiting next step',
        reporting_period_start: null,
        reporting_period_end: null,
      }),
    ]);

    expect(options[0]).toMatchObject({
      label: 'PMO June.xlsx',
      statusLabel: 'Published',
      reportingPeriodLabel: '2026-06-29 to 2026-07-03',
      reportingPeriodStart: '2026-06-29',
      reportingPeriodEnd: '2026-07-03',
      disabled: false,
    });
    expect(options[1]).toMatchObject({
      statusLabel: 'Awaiting next step',
      reportingPeriodLabel: '2026-W26',
      disabled: true,
    });
  });

  it('detects custom date range state explicitly', () => {
    expect(hasCustomDateRange(undefined)).toBe(false);
    expect(hasCustomDateRange({ ingestionSessionId: 's1' })).toBe(false);
    expect(hasCustomDateRange({ from: '2026-06-29', to: '2026-07-03' })).toBe(true);
  });

  it('classifies the utilization empty states', () => {
    expect(
      utilizationEmptyState({
        hasAnalyticsData: false,
        hasNoDataError: true,
        hasActiveDataFilters: false,
        sessions: [],
      }),
    ).toBe('no_uploads');

    expect(
      utilizationEmptyState({
        hasAnalyticsData: false,
        hasNoDataError: true,
        hasActiveDataFilters: false,
        sessions: [session({ is_published: false })],
      }),
    ).toBe('unpublished_uploads');

    expect(
      utilizationEmptyState({
        hasAnalyticsData: false,
        hasNoDataError: true,
        hasActiveDataFilters: true,
        sessions: [session()],
      }),
    ).toBe('filter_empty');
  });
});
