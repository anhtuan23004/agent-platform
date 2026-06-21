import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PmoReportStatusResponse } from '../../../../../src/modules/pmo/api/client';
import { ReportStatusCard } from '../../../../../src/modules/pmo/components/pmo-report-panel';

function report(status: PmoReportStatusResponse['status']): PmoReportStatusResponse {
  return {
    reportRunId: '33333333-3333-4333-8333-333333333333',
    status,
    dateRange: { from: '2026-06-29', to: '2026-08-07' },
    outputFormat: 'pdf',
    summary: { memberCount: 10, overbookCount: 2, idleCount: 3, excludedWeekCount: 0 },
    findingCounts: { red: 1, yellow: 4, idle: 3, overbook: 2 },
    artifacts: {
      html: { available: false, sizeBytes: null, sha256: null, downloadUrl: null },
      pdf: {
        available: status === 'completed',
        sizeBytes: status === 'completed' ? 4096 : null,
        sha256: status === 'completed' ? 'a'.repeat(64) : null,
        downloadUrl:
          status === 'completed'
            ? '/api/pmo/v1/reports/33333333-3333-4333-8333-333333333333/download?format=pdf'
            : null,
      },
    },
    failure: status === 'failed' ? { code: 'render_failed', message: 'Render failed' } : null,
    retryAllowed: status === 'failed',
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:01:00.000Z',
    completedAt: status === 'completed' ? '2026-06-21T00:02:00.000Z' : null,
  };
}

describe('PmoReportStatusCard', () => {
  it('shows completed counts and PDF download', () => {
    render(<ReportStatusCard report={report('completed')} isRetrying={false} onRetry={vi.fn()} />);
    expect(screen.getByText('Report ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download PDF/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/download?format=pdf'),
    );
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows progress and retry only for failed run', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ReportStatusCard report={report('rendering')} isRetrying={false} onRetry={onRetry} />,
    );
    expect(screen.getByText('Rendering PDF')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();

    rerender(<ReportStatusCard report={report('failed')} isRetrying={false} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText('Render failed')).toBeInTheDocument();
  });
});
