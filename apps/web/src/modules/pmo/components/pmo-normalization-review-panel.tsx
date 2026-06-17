import { Button, Input, Label } from '@seta/shared-ui';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import type { MemberMasterAdditionDraft } from '../hooks/use-pmo-normalization-review-actions';
import type { NormalizationReviewViewModel } from '../pages/pmo-page.logic';

interface PmoNormalizationReviewPanelProps {
  selectedNormalizationApproval: WorkflowApprovalRow | null;
  normalizationApprovalsCount: number;
  selectedNormalizationView: NormalizationReviewViewModel | null;
  memberAdditionDrafts: MemberMasterAdditionDraft[];
  canApproveNormalization: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateMemberAdditionDraft: (
    memberId: string,
    field: keyof Omit<MemberMasterAdditionDraft, 'member_id'>,
    value: string,
  ) => void;
  approveNormalization: () => void;
  rejectNormalization: () => void;
}

function KvGrid(props: { rows: Array<{ k: string; v: string }>; emptyLabel: string }) {
  const { rows, emptyLabel } = props;
  if (!rows.length) return <p className="text-caption text-ink-subtle">{emptyLabel}</p>;

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

export function PmoNormalizationReviewPanel(props: PmoNormalizationReviewPanelProps) {
  const {
    selectedNormalizationApproval,
    normalizationApprovalsCount,
    selectedNormalizationView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision,
    updateMemberAdditionDraft,
    approveNormalization,
    rejectNormalization,
  } = props;

  if (!selectedNormalizationApproval) {
    return (
      <p className="text-ink-subtle">
        {normalizationApprovalsCount > 0
          ? 'Found pending normalization approvals, but they are not linked to the currently selected session. Try Refresh or select a different session.'
          : 'No pending normalization review for this session.'}
      </p>
    );
  }

  if (!selectedNormalizationView) {
    return (
      <p className="text-ink-subtle">
        Normalization review is pending, but the approval card could not be rendered.
      </p>
    );
  }

  const missingMemberCount = selectedNormalizationView.missingMembers.length;

  return (
    <>
      <div className="rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
        Normalization review is required. Staging continues only after PMO validates the data
        quality result for this step.
      </div>

      <section className="rounded-lg border border-hairline bg-surface-1 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-body-sm font-semibold text-ink">Validate normalized data</h4>
            <p className="mt-1 text-caption text-ink-subtle">{selectedNormalizationView.summary}</p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-caption font-medium ${
              selectedNormalizationView.canApprove && missingMemberCount === 0
                ? 'bg-success-tint text-success-ink'
                : 'bg-warning-tint text-warning-ink'
            }`}
          >
            {missingMemberCount > 0
              ? `${missingMemberCount} member(s) need master data`
              : selectedNormalizationView.canApprove
                ? 'Ready to stage'
                : 'Needs correction'}
          </span>
        </div>

        <div className="mt-3">
          <KvGrid
            rows={selectedNormalizationView.summaryRows}
            emptyLabel="No normalization summary was provided."
          />
        </div>

        {selectedNormalizationView.tableRows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-caption">
              <thead className="border-b border-hairline text-ink-subtle">
                <tr>
                  <th className="px-2 py-1.5">Table</th>
                  <th className="px-2 py-1.5">Normalization result</th>
                </tr>
              </thead>
              <tbody>
                {selectedNormalizationView.tableRows.map((row) => (
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

        {selectedNormalizationView.issueRows.length > 0 ? (
          <div className="mt-3 rounded-lg border border-danger-border bg-danger-tint/60 p-3">
            <p className="text-caption font-medium text-danger-ink">Validation findings</p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-caption">
                <tbody>
                  {selectedNormalizationView.issueRows.map((row) => (
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

        {missingMemberCount > 0 ? (
          <div className="mt-3 rounded-lg border border-hairline bg-canvas p-3">
            <p className="text-caption font-medium text-ink">Add missing member master data</p>
            <p className="mt-1 text-caption text-ink-subtle">
              These member IDs were not found in the workbook member master sheet or active
              database.
            </p>

            <div className="mt-3 space-y-3">
              {memberAdditionDrafts.map((draft) => (
                <div
                  key={draft.member_id}
                  className="grid gap-2 rounded-md border border-hairline bg-surface-1 p-2 sm:grid-cols-4"
                >
                  <div className="space-y-1">
                    <Label htmlFor={`member-id-${draft.member_id}`}>Member ID</Label>
                    <Input id={`member-id-${draft.member_id}`} value={draft.member_id} disabled />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`member-name-${draft.member_id}`}>Full name</Label>
                    <Input
                      id={`member-name-${draft.member_id}`}
                      value={draft.full_name}
                      onChange={(event) =>
                        updateMemberAdditionDraft(draft.member_id, 'full_name', event.target.value)
                      }
                      disabled={isSubmittingNormalizationDecision}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`member-department-${draft.member_id}`}>Department</Label>
                    <Input
                      id={`member-department-${draft.member_id}`}
                      value={draft.department}
                      onChange={(event) =>
                        updateMemberAdditionDraft(draft.member_id, 'department', event.target.value)
                      }
                      disabled={isSubmittingNormalizationDecision}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`member-role-${draft.member_id}`}>Role title</Label>
                    <Input
                      id={`member-role-${draft.member_id}`}
                      value={draft.role_title}
                      onChange={(event) =>
                        updateMemberAdditionDraft(draft.member_id, 'role_title', event.target.value)
                      }
                      disabled={isSubmittingNormalizationDecision}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-hairline bg-canvas p-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isSubmittingNormalizationDecision}
            onClick={rejectNormalization}
          >
            {isSubmittingNormalizationDecision ? 'Submitting...' : 'Reject normalization'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={!canApproveNormalization}
            onClick={approveNormalization}
          >
            {isSubmittingNormalizationDecision
              ? 'Submitting...'
              : missingMemberCount > 0
                ? 'Add members & continue'
                : 'Approve normalization'}
          </Button>
        </div>
      </section>
    </>
  );
}
