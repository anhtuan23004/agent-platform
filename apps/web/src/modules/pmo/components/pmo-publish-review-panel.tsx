import { Button } from '@seta/shared-ui';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import type { PublishReviewViewModel } from '../pages/pmo-page.logic';

interface PmoPublishReviewPanelProps {
  readOnly?: boolean;
  selectedPublishApproval: WorkflowApprovalRow | null;
  publishApprovalsCount: number;
  selectedPublishView: PublishReviewViewModel | null;
  isSubmittingPublishDecision: boolean;
  approvePublish: () => void;
  rejectPublish: () => void;
}

function KeyValueRows(props: { rows: Array<{ k: string; v: string }>; emptyLabel: string }) {
  const { rows, emptyLabel } = props;

  if (rows.length === 0) {
    return <p className="text-caption text-ink-subtle">{emptyLabel}</p>;
  }

  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => (
        <div key={`${row.k}-${row.v}`} className="rounded-md border border-hairline bg-canvas p-2">
          <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">{row.k}</dt>
          <dd className="mt-0.5 font-medium text-ink">{row.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PmoPublishReviewPanel(props: PmoPublishReviewPanelProps) {
  const {
    readOnly = false,
    selectedPublishApproval,
    publishApprovalsCount,
    selectedPublishView,
    isSubmittingPublishDecision,
    approvePublish,
    rejectPublish,
  } = props;

  if (!selectedPublishApproval) {
    return (
      <p className="text-ink-subtle">
        {publishApprovalsCount > 0
          ? 'Found pending publish approvals, but they are not linked to the currently selected session. Try Refresh or select a different session.'
          : 'No pending publish review for this session.'}
      </p>
    );
  }

  if (!selectedPublishView) {
    return (
      <p className="text-ink-subtle">
        Publish review is pending, but the approval card could not be rendered.
      </p>
    );
  }

  return (
    <>
      {readOnly ? (
        <div className="rounded-lg border border-hairline bg-surface-2/60 px-3 py-2 text-caption text-ink-subtle">
          This publish review has been completed. Showing historical data (read-only).
        </div>
      ) : (
        <div className="rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
          Publish review is required. The workflow can publish only after PMO approves this step.
        </div>
      )}

      <section className="rounded-lg border border-hairline bg-surface-1 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-body-sm font-semibold text-ink">Review staging changes</h4>
            <p className="mt-1 text-caption text-ink-subtle">{selectedPublishView.summary}</p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-caption font-medium ${
              selectedPublishView.canApprove
                ? 'bg-success-tint text-success-ink'
                : 'bg-danger-tint text-danger-ink'
            }`}
          >
            {selectedPublishView.canApprove ? 'Ready to publish' : 'Blocked'}
          </span>
        </div>

        <div className="mt-3">
          <KeyValueRows
            rows={selectedPublishView.summaryRows}
            emptyLabel="No publish summary was provided."
          />
        </div>

        {selectedPublishView.tableRows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-caption">
              <thead className="border-b border-hairline text-ink-subtle">
                <tr>
                  <th className="px-2 py-1.5">Scope</th>
                  <th className="px-2 py-1.5">Impact</th>
                </tr>
              </thead>
              <tbody>
                {selectedPublishView.tableRows.map((row) => (
                  <tr
                    key={`${row.k}-${row.v}`}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <td className="px-2 py-1.5 font-medium text-ink">{row.k}</td>
                    <td className="px-2 py-1.5 text-ink-subtle">{row.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {selectedPublishView.issueRows.length > 0 ? (
          <div className="mt-3 rounded-lg border border-danger-border bg-danger-tint/60 p-3">
            <p className="text-caption font-medium text-danger-ink">Blocking issues</p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-caption">
                <tbody>
                  {selectedPublishView.issueRows.map((row) => (
                    <tr
                      key={`${row.k}-${row.v}`}
                      className="border-b border-danger-border/70 last:border-b-0"
                    >
                      <td className="px-2 py-1.5 font-medium text-danger-ink">{row.k}</td>
                      <td className="px-2 py-1.5 text-danger-ink/80">{row.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {selectedPublishView.checklist.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-caption text-ink-subtle">
            {selectedPublishView.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {readOnly ? null : (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-hairline bg-canvas p-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSubmittingPublishDecision}
              onClick={rejectPublish}
            >
              {isSubmittingPublishDecision
                ? 'Submitting...'
                : (selectedPublishView.declineLabel ?? 'Reject publish')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selectedPublishView.canApprove ? 'primary' : 'destructive'}
              disabled={isSubmittingPublishDecision}
              onClick={selectedPublishView.canApprove ? approvePublish : rejectPublish}
            >
              {isSubmittingPublishDecision ? 'Submitting...' : selectedPublishView.primaryLabel}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
