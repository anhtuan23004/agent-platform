import { Button, Dropzone } from '@seta/shared-ui';
import { Loader2 } from 'lucide-react';
import type {
  PmoProfilingArea,
  PmoProfilingReviewState,
  PmoSessionDocumentProfileRecord,
  PmoWorkbookProfilingSessionSummary,
  PmoWorkflowExecutionStepStatus,
} from '../api/client';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import {
  documentStatusTone,
  formatLocalDate,
  profilingSheetKey,
  workflowStepTone,
} from '../pages/pmo-page.logic';

export interface ProfilingOverrideEntry {
  finalArea: PmoProfilingArea;
  markIgnore: boolean;
}

interface PmoProfilingDetailsPanelProps {
  stepStatus: PmoWorkflowExecutionStepStatus;
  isCurrent: boolean;
  isProfilingStepReadOnly: boolean;
  isApprovedReadOnly: boolean;
  profilingReviewState: PmoProfilingReviewState | null | undefined;
  profilingSummary: PmoWorkbookProfilingSessionSummary | null | undefined;
  profilingDocuments: PmoSessionDocumentProfileRecord[];
  /** Real approval row from agent.workflow_approvals — null when no approval exists. */
  profilingApproval: WorkflowApprovalRow | null;
  selectedSessionOverrides: Record<string, ProfilingOverrideEntry>;
  profilingAreas: PmoProfilingArea[];
  isAppendingDocument: boolean;
  isSavingProfilingReview: boolean;
  isApprovingProfiling: boolean;
  canShowProfilingActions: boolean;
  dropzoneAccept: string;
  dropzoneMaxBytes: number;
  handleAppendDocument: (file: File) => Promise<void>;
  handleSaveProfilingReview: () => Promise<void>;
  handleApproveProfilingContinue: () => Promise<void>;
  onSelectSheetArea: (
    documentId: string,
    sheetName: string,
    selectedArea: PmoProfilingArea,
  ) => void;
  onToggleSheetIgnore: (
    documentId: string,
    sheetName: string,
    checked: boolean,
    fallbackArea: PmoProfilingArea,
  ) => void;
}

export function PmoProfilingDetailsPanel(props: PmoProfilingDetailsPanelProps) {
  const {
    stepStatus,
    isCurrent,
    isProfilingStepReadOnly,
    isApprovedReadOnly,
    profilingReviewState,
    profilingSummary,
    profilingDocuments,
    profilingApproval: _profilingApproval,
    selectedSessionOverrides,
    profilingAreas,
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    canShowProfilingActions,
    dropzoneAccept,
    dropzoneMaxBytes,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    onSelectSheetArea,
    onToggleSheetIgnore,
  } = props;

  // Approve is possible when the profiling review is in needs_review and the
  // step has not failed/cancelled.  A pending agent approval row is preferred
  // (agent-driven workflow) but NOT required — the PMO page can approve
  // directly via /api/pmo/v1/profiling/approve-continue as a fallback.
  const canApproveProfiling =
    profilingReviewState?.status === 'needs_review' &&
    stepStatus !== 'failed' &&
    stepStatus !== 'cancelled';

  return (
    <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">Workbook Profiling details</p>
        <span
          className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(stepStatus).badge}`}
        >
          {workflowStepTone(stepStatus).label}
        </span>
        {profilingReviewState ? (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-ink-subtle">
            Review: {profilingReviewState.status === 'approved' ? 'Approved' : 'Needs review'}
          </span>
        ) : null}
        {isProfilingStepReadOnly ? (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-ink-subtle">
            View only
          </span>
        ) : null}
      </div>

      {profilingSummary ? (
        <div className="grid gap-2 text-ink-subtle sm:grid-cols-2 lg:grid-cols-4">
          <p>
            Documents:{' '}
            <span className="font-medium text-ink">
              {profilingSummary.profiled_document_count} / {profilingSummary.document_count}
            </span>
          </p>
          <p>
            Sheets:{' '}
            <span className="font-medium text-ink">{profilingSummary.total_sheet_count}</span>
          </p>
          <p>
            Rows: <span className="font-medium text-ink">{profilingSummary.total_row_count}</span>
          </p>
          <p>
            Generated:{' '}
            <span className="font-medium text-ink">
              {formatLocalDate(profilingSummary.generated_at)}
            </span>
          </p>
        </div>
      ) : (
        <p className="text-ink-subtle">
          No profiling summary yet. Approve plan to start profiling.
        </p>
      )}

      {profilingSummary?.detected_data_areas.length ? (
        <p>
          Detected data areas:{' '}
          <span className="font-medium text-ink">
            {profilingSummary.detected_data_areas.join(', ')}
          </span>
        </p>
      ) : null}

      {profilingSummary?.suggested_next_step ? (
        <p>
          Recommendation:{' '}
          <span className="font-medium text-ink">{profilingSummary.suggested_next_step}</span>
        </p>
      ) : null}

      <div className="space-y-1.5">
        <p className="font-medium text-ink">Profiled documents</p>
        {profilingDocuments.length === 0 ? (
          <p className="text-ink-subtle">No document records yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {profilingDocuments.map((doc) => {
              const docTone = documentStatusTone(doc.status);
              const sheetCount = doc.profile_result?.workbook_summary.sheet_count ?? 0;
              const rowCount = doc.profile_result?.workbook_summary.total_rows ?? 0;

              return (
                <li
                  key={doc.document_id}
                  className="rounded-md border border-hairline bg-surface-1 px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ink">{doc.file_name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-caption font-medium ${docTone.badge}`}
                    >
                      {docTone.label}
                    </span>
                  </div>
                  <div
                    className={`mt-1 grid gap-1 sm:grid-cols-3 ${
                      isApprovedReadOnly ? 'text-ink-subtle' : 'text-ink'
                    }`}
                  >
                    <p>Uploaded: {formatLocalDate(doc.uploaded_at)}</p>
                    <p>Sheets: {sheetCount}</p>
                    <p>Rows: {rowCount}</p>
                  </div>
                  {doc.profile_result?.sheets.length ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-full text-left text-caption">
                        <thead className="border-b border-hairline text-ink-subtle">
                          <tr>
                            <th className="px-1.5 py-1">Sheet</th>
                            <th className="px-1.5 py-1">Predicted meaning</th>
                            <th className="px-1.5 py-1">Confidence</th>
                            <th className="px-1.5 py-1">Action</th>
                            <th className="px-1.5 py-1">Override</th>
                          </tr>
                        </thead>
                        <tbody>
                          {doc.profile_result.sheets.map((sheet) => {
                            const key = profilingSheetKey(doc.document_id, sheet.sheet_name);
                            const override = selectedSessionOverrides[key];
                            const fallbackArea =
                              sheet.final_decision?.area ?? sheet.candidate_business_area;
                            const effectiveArea = override?.markIgnore
                              ? 'unknown'
                              : (override?.finalArea ?? fallbackArea);

                            return (
                              <tr
                                key={`${doc.document_id}-${sheet.sheet_name}`}
                                className="border-b border-hairline"
                              >
                                <td className="px-1.5 py-1 text-ink">{sheet.sheet_name}</td>
                                <td
                                  className={`px-1.5 py-1 ${
                                    isApprovedReadOnly ? 'text-ink-subtle' : 'text-ink'
                                  }`}
                                >
                                  {sheet.likely_purpose}
                                </td>
                                <td
                                  className={`px-1.5 py-1 ${
                                    isApprovedReadOnly ? 'text-ink-subtle' : 'text-ink'
                                  }`}
                                >
                                  {sheet.final_decision?.confidence ??
                                    (sheet.confidence >= 0.8
                                      ? 'high'
                                      : sheet.confidence >= 0.55
                                        ? 'medium'
                                        : 'low')}
                                </td>
                                <td
                                  className={`px-1.5 py-1 ${
                                    isApprovedReadOnly ? 'text-ink-subtle' : 'text-ink'
                                  }`}
                                >
                                  {sheet.llm_interpretation?.recommended_action ?? 'review'}
                                </td>
                                <td className="px-1.5 py-1">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <select
                                      className="rounded border border-hairline bg-canvas px-1 py-0.5 text-caption disabled:cursor-not-allowed disabled:opacity-70"
                                      value={effectiveArea}
                                      disabled={isProfilingStepReadOnly}
                                      onChange={(event) => {
                                        const selectedArea = event.target.value as PmoProfilingArea;
                                        onSelectSheetArea(
                                          doc.document_id,
                                          sheet.sheet_name,
                                          selectedArea,
                                        );
                                      }}
                                    >
                                      {profilingAreas.map((area) => (
                                        <option key={area} value={area}>
                                          {area}
                                        </option>
                                      ))}
                                    </select>
                                    <label className="inline-flex items-center gap-1 text-caption text-ink-subtle">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(override?.markIgnore)}
                                        disabled={isProfilingStepReadOnly}
                                        onChange={(event) => {
                                          onToggleSheetIgnore(
                                            doc.document_id,
                                            sheet.sheet_name,
                                            event.target.checked,
                                            fallbackArea,
                                          );
                                        }}
                                      />
                                      Ignore
                                    </label>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {doc.error_message ? (
                    <p className="mt-1 text-danger-ink">Error: {doc.error_message}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* "Waiting for agent" gate removed — the PMO page can approve profiling
          directly via /api/pmo/v1/profiling/approve-continue when no agent
          approval row exists. */}

      {canShowProfilingActions && isCurrent ? (
        <div className="space-y-2">
          <Dropzone
            accept={dropzoneAccept}
            maxBytes={dropzoneMaxBytes}
            label="Upload supplemental workbook to this session"
            hint="The new document is appended and profiled without restarting workflow"
            pendingLabel="Uploading and profiling..."
            tooLargeMessage="That file is over 50 MB. Try a smaller workbook."
            isPending={isAppendingDocument}
            onFile={handleAppendDocument}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleSaveProfilingReview}
              disabled={isSavingProfilingReview}
            >
              {isSavingProfilingReview ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving review...
                </>
              ) : (
                'Save profiling review'
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={handleApproveProfilingContinue}
              disabled={isApprovingProfiling || !canApproveProfiling}
            >
              {isApprovingProfiling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Approving profiling...
                </>
              ) : (
                'Approve Profiling & Continue'
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
