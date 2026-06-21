import type { GeneratePmoReportOutput } from '../../analytics/report.ts';
import type { ReportSourceMode } from '../contracts.ts';

export interface PmoReportRenderModel {
  reportRunId: string;
  tenantName: string;
  generatedAt: string;
  sourceMode: ReportSourceMode;
  rule: {
    ruleSetId: string;
    version: string;
    sha256: string;
  };
  report: GeneratePmoReportOutput;
}

export interface RenderedReportHtml {
  html: string;
  sha256: string;
  sizeBytes: number;
}
