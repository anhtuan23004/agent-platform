import { Button, ChatToolCall, toast } from '@seta/shared-ui';
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { ReportStatusCard } from '../../../pmo/components/pmo-report-panel';
import {
  useCreatePmoReport,
  usePmoReport,
  useRetryPmoReport,
} from '../../../pmo/hooks/use-pmo-report';

interface PmoGenerateReportRendererProps {
  name: string;
  state: 'input-streaming' | 'output-available' | 'output-error';
  output?: {
    reportRunId?: string;
    dateRange?: { from: string; to: string };
    summary?: { memberCount?: number; overbookCount?: number; idleCount?: number };
  };
}

export function PmoGenerateReportRenderer(props: PmoGenerateReportRendererProps) {
  const sourceReportRunId = props.output?.reportRunId ?? null;
  const [pdfReportRunId, setPdfReportRunId] = useState<string | null>(null);
  const report = usePmoReport(pdfReportRunId ?? sourceReportRunId);
  const create = useCreatePmoReport();
  const retry = useRetryPmoReport();

  if (props.state === 'output-error') {
    return <ChatToolCall name={props.name} status="error" summary="failed" />;
  }
  if (props.state !== 'output-available') {
    return <ChatToolCall name={props.name} status="running" summary="Generating report" />;
  }
  if (report.data) {
    if (
      report.data.status === 'completed' &&
      !report.data.artifacts.pdf.available &&
      !pdfReportRunId &&
      props.output?.dateRange
    ) {
      const dateRange = props.output.dateRange;
      return (
        <div className="space-y-2">
          <ChatToolCall
            name={props.name}
            status="ok"
            summary={`${props.output.summary?.overbookCount ?? 0} overbook · ${props.output.summary?.idleCount ?? 0} idle`}
            payload={props.output}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                {
                  dateRange,
                  reportTypes: ['overbook', 'idle'],
                  recommendationCandidateCount: 3,
                },
                {
                  onSuccess: (next) => setPdfReportRunId(next.reportRunId),
                  onError: (error) =>
                    toast.error('PDF request failed', { description: error.message }),
                },
              )
            }
          >
            <FileDown /> Generate PDF
          </Button>
        </div>
      );
    }
    return (
      <ReportStatusCard
        report={report.data}
        isRetrying={retry.isPending}
        onRetry={() => retry.mutate(report.data.reportRunId)}
      />
    );
  }
  const summary = props.output?.summary;
  return (
    <ChatToolCall
      name={props.name}
      status="ok"
      summary={
        summary
          ? `${summary.overbookCount ?? 0} overbook · ${summary.idleCount ?? 0} idle`
          : (sourceReportRunId ?? 'completed')
      }
      payload={props.output}
    />
  );
}
