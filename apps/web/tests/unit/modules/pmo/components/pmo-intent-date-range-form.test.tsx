import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntentReportDateRangeForm } from '../../../../../src/modules/pmo/components/pmo-workflow-cards-section';

describe('IntentReportDateRangeForm', () => {
  const request = {
    source: 'post_ingest_database' as const,
    date_range_strategy: 'sheet_or_database_confirmation' as const,
    date_range: null,
    report_types: ['idle_members' as const],
    database_date_bounds: { min: '2026-01-01', max: '2026-03-31' },
  };

  it('confirms sheet-derived date strategy from intent card', () => {
    const onConfirm = vi.fn();
    render(
      <IntentReportDateRangeForm request={request} isSubmitting={false} onConfirm={onConfirm} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use dates from sheet' }));

    expect(onConfirm).toHaveBeenCalledWith({ dateRangeStrategy: 'sheet_derived' });
  });

  it('confirms manual database range within DB bounds', () => {
    const onConfirm = vi.fn();
    render(
      <IntentReportDateRangeForm request={request} isSubmitting={false} onConfirm={onConfirm} />,
    );

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-02-28' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use database range' }));

    expect(onConfirm).toHaveBeenCalledWith({
      dateRangeStrategy: 'manual_database',
      dateRange: { from: '2026-02-01', to: '2026-02-28' },
    });
  });
});
