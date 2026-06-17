import { useMutation } from '@tanstack/react-query';
import { pmoApi } from '../api/client';

export interface UploadPmoWorkbookInput {
  file: File;
  reportingPeriodKey?: string;
}

export interface UploadPmoWorkbookResult {
  ingestionSessionId: string;
  fileKey: string;
  fileName?: string;
  reportingPeriodKey?: string;
}

export interface StartPmoIngestInput {
  ingestionSessionId: string;
  fileKey: string;
  reportingPeriodKey?: string;
}

export interface StartPmoIngestResult {
  runId: string;
  ingestionSessionId: string;
  fileKey: string;
  reportingPeriodKey?: string;
}

export function useUploadPmoWorkbook() {
  return useMutation({
    mutationFn: async ({ file, reportingPeriodKey }: UploadPmoWorkbookInput) => {
      const uploaded = await pmoApi.uploadWorkbook(file, reportingPeriodKey);

      return {
        ingestionSessionId: uploaded.ingestion_session_id,
        fileKey: uploaded.s3_key,
        fileName: uploaded.filename,
        reportingPeriodKey,
      } satisfies UploadPmoWorkbookResult;
    },
  });
}

export function useStartPmoIngest() {
  return useMutation({
    mutationFn: async ({
      ingestionSessionId,
      fileKey,
      reportingPeriodKey,
    }: StartPmoIngestInput) => {
      const started = await pmoApi.startIngestWorkflow({
        ingestionSessionId,
        fileKey,
        reportingPeriodKey,
      });

      return {
        runId: started.runId,
        ingestionSessionId,
        fileKey,
        reportingPeriodKey,
      } satisfies StartPmoIngestResult;
    },
  });
}
