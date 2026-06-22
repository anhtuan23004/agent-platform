import type { ReportSourceMode } from '../contracts.ts';
import type { GeneratePmoReportOutput } from '../report-output.ts';

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
