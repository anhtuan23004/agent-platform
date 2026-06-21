import { Button, Input, Label, toast } from '@seta/shared-ui';
import { Download, FileText, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { PmoReportStatusResponse } from '../api/client';
import { useCreatePmoReport, usePmoReport, useRetryPmoReport } from '../hooks/use-pmo-report';

export function PmoReportPanel() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reportRunId, setReportRunId] = useState<string | null>(null);
  const create = useCreatePmoReport();
  const retry = useRetryPmoReport();
  const report = usePmoReport(reportRunId);
  const value = report.data ?? create.data ?? null;
  const validRange = Boolean(from && to && from <= to);

  const submit = () => {
    if (!validRange) return;
    create.mutate(
      {
        dateRange: { from, to },
        reportTypes: ['overbook', 'idle'],
        recommendationCandidateCount: 3,
      },
      {
        onSuccess: (next) => setReportRunId(next.reportRunId),
        onError: (error) => toast.error('Report request failed', { description: error.message }),
      },
    );
  };

  return (
    <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md bg-primary-tint p-2 text-primary">
          <FileText className="size-5" />
        </span>
        <div>
          <h2 className="text-body-sm font-semibold text-ink">Resource allocation report</h2>
          <p className="mt-0.5 text-body-sm text-ink-subtle">
            Generate private PDF from persisted PMO facts. Date range confirmation required.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="pmo-report-from">From</Label>
          <Input
            id="pmo-report-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pmo-report-to">To</Label>
          <Input
            id="pmo-report-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button type="button" onClick={submit} disabled={!validRange || create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : null}
          Generate PDF
        </Button>
      </div>
      {value ? (
        <ReportStatusCard
          report={value}
          isRetrying={retry.isPending}
          onRetry={() =>
            retry.mutate(value.reportRunId, {
              onError: (error) => toast.error('Retry failed', { description: error.message }),
            })
          }
        />
      ) : null}
    </section>
  );
}

export function ReportStatusCard(props: {
  report: PmoReportStatusResponse;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const { report, isRetrying, onRetry } = props;
  const active =
    report.status === 'queued' || report.status === 'computing' || report.status === 'rendering';
  return (
    <div className="mt-3 rounded-lg border border-hairline bg-surface-1 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {active ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
          <strong className="text-body-sm text-ink">{statusLabel(report.status)}</strong>
          <span className="font-mono text-caption text-ink-subtle">{report.reportRunId}</span>
        </div>
        <div className="flex gap-2">
          {report.artifacts.pdf.downloadUrl ? (
            <Button size="sm" variant="primary" asChild>
              <a href={report.artifacts.pdf.downloadUrl}>
                <Download /> Download PDF
              </a>
            </Button>
          ) : null}
          {report.retryAllowed ? (
            <Button size="sm" variant="secondary" onClick={onRetry} disabled={isRetrying}>
              <RotateCcw /> Retry
            </Button>
          ) : null}
        </div>
      </div>
      {report.findingCounts ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(report.findingCounts).map(([key, count]) => (
            <div key={key} className="rounded-md border border-hairline bg-canvas px-2 py-1.5">
              <dt className="text-caption uppercase text-ink-subtle">{key}</dt>
              <dd className="font-mono text-body-sm text-ink">{count}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {report.failure?.message ? (
        <p className="mt-2 text-body-sm text-danger-ink">{report.failure.message}</p>
      ) : null}
    </div>
  );
}

function statusLabel(status: PmoReportStatusResponse['status']): string {
  if (status === 'queued') return 'Report queued';
  if (status === 'computing') return 'Computing findings';
  if (status === 'rendering') return 'Rendering PDF';
  if (status === 'completed') return 'Report ready';
  return 'Report failed';
}
