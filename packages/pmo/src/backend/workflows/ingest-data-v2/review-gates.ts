import type { z } from 'zod';
import type { StagingOutputSchema } from './schemas.ts';

type ChangeSummary = z.infer<typeof StagingOutputSchema>['changeSummary'];

interface PublishGateInput {
  changeSummary: ChangeSummary;
  hasBlockingIssues: boolean;
}

export function hasDuplicateInUpload(changeSummary: ChangeSummary): boolean {
  return changeSummary.some((table) => table.counts.duplicates_in_upload > 0);
}

export function shouldBlockPublishApprove(input: PublishGateInput): boolean {
  return input.hasBlockingIssues;
}
