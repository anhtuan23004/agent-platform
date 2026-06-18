import { Badge, Button, Input, Label } from '@seta/shared-ui';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Copy,
  Database,
  Link2Off,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import type { MemberMasterAdditionDraft } from '../hooks/use-pmo-normalization-review-actions';
import type {
  NormalizationReviewRow,
  NormalizationReviewTableGroup,
  NormalizationReviewViewModel,
} from '../pages/pmo-page.logic';

interface PmoNormalizationReviewPanelProps {
  readOnly?: boolean;
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
  updateNormalizationRowDecision: (
    rowId: string,
    decision: Extract<NormalizationReviewRow['decision'], 'keep_row' | 'skip_row'>,
  ) => void;
  updateNormalizationRowValue: (rowId: string, columnKey: string, value: string) => void;
  resetNormalizationRowOverrides: (rowId: string) => void;
  approveNormalization: () => void;
  rejectNormalization: () => void;
}

const STATUS_CLASS: Record<NormalizationReviewRow['status'], string> = {
  blocked: 'border-danger-border bg-danger-tint text-danger-ink',
  duplicate: 'border-warning-border bg-warning-tint text-warning-ink',
  warning: 'border-warning-border bg-warning-tint text-warning-ink',
  skipped: 'border-hairline bg-surface-2 text-ink-subtle',
};

const DECISION_LABEL: Record<NormalizationReviewRow['decision'], string> = {
  keep_row: 'Keep row',
  skip_row: 'Skip row',
  skipped: 'Skipped',
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function parseSummaryNumber(rows: Array<{ k: string; v: string }>, key: RegExp): number {
  const row = rows.find((item) => key.test(item.k));
  if (!row) return 0;
  const match = row.v.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function SummaryCard(props: {
  label: string;
  value: string | number;
  hint: string;
  tone: 'neutral' | 'success' | 'danger' | 'warning' | 'purple';
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}) {
  const Icon = props.icon;
  const toneClass = {
    neutral: 'bg-surface-2 text-ink-subtle',
    success: 'bg-success-tint text-success-ink',
    danger: 'bg-danger-tint text-danger-ink',
    warning: 'bg-warning-tint text-warning-ink',
    purple: 'bg-primary-tint text-primary-ink',
  }[props.tone];

  return (
    <div className="flex min-h-[72px] items-center gap-3 rounded-lg border border-hairline bg-surface-1 p-3">
      <span
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${toneClass}`}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-caption font-medium text-ink-subtle">{props.label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-none text-ink">{props.value}</p>
        <p className="mt-1 text-caption text-ink-subtle">{props.hint}</p>
      </div>
    </div>
  );
}

function statusLabel(row: NormalizationReviewRow): string {
  if (row.status === 'duplicate') return 'Duplicate';
  if (row.status === 'skipped') return 'Skipped';
  if (row.status === 'warning') return 'Warning';
  return row.issueLabel || 'Blocked';
}

function rowLabel(row: NormalizationReviewRow): string {
  const prefix = row.sourceSheet || row.tableId;
  return `${prefix}-${String(row.sourceRow).padStart(4, '0')}`;
}

function issueGroupTone(groupLabel: string): string {
  if (/duplicate/i.test(groupLabel)) return 'text-warning-ink';
  if (/missing|parse|multiple/i.test(groupLabel)) return 'text-danger-ink';
  return 'text-ink-subtle';
}

function NormalizationIssueTable(props: {
  group: NormalizationReviewTableGroup;
  readOnly: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateNormalizationRowDecision: PmoNormalizationReviewPanelProps['updateNormalizationRowDecision'];
  updateNormalizationRowValue: PmoNormalizationReviewPanelProps['updateNormalizationRowValue'];
  resetNormalizationRowOverrides: PmoNormalizationReviewPanelProps['resetNormalizationRowOverrides'];
}) {
  const {
    group,
    readOnly,
    isSubmittingNormalizationDecision,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
  } = props;
  const columns = group.columns.length > 0 ? group.columns : [];
  const columnCount = 5 + Math.max(columns.length, 1);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full table-fixed border-t border-hairline text-left text-caption">
        <thead className="bg-surface-1 text-ink-subtle">
          <tr className="border-b border-hairline">
            <th rowSpan={2} className="w-24 px-3 py-2 font-medium">
              Row ID
            </th>
            <th rowSpan={2} className="w-32 px-3 py-2 font-medium">
              Status
            </th>
            <th colSpan={Math.max(columns.length, 1)} className="px-3 py-2 text-center font-medium">
              Details
            </th>
            <th rowSpan={2} className="w-56 px-3 py-2 font-medium">
              Issue
            </th>
            <th rowSpan={2} className="w-36 px-3 py-2 font-medium">
              Decision
            </th>
            <th rowSpan={2} className="w-36 px-3 py-2 font-medium">
              Actions
            </th>
          </tr>
          <tr className="border-b border-hairline">
            {columns.length > 0 ? (
              columns.map((column) => (
                <th key={column.key} className="min-w-28 px-3 py-2 font-medium">
                  {column.label}
                </th>
              ))
            ) : (
              <th className="min-w-28 px-3 py-2 font-medium">Values</th>
            )}
          </tr>
        </thead>
        <tbody>
          {group.issueGroups.map((issueGroup) => (
            <FragmentLike key={issueGroup.groupId}>
              <tr className="border-b border-hairline bg-canvas">
                <td
                  colSpan={columnCount}
                  className={`px-3 py-2 font-semibold ${issueGroupTone(issueGroup.groupLabel)}`}
                >
                  {issueGroup.groupLabel} · {issueGroup.rows.length} row
                  {issueGroup.rows.length === 1 ? '' : 's'}
                </td>
              </tr>
              {issueGroup.rows.map((row) => (
                <tr key={row.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2 font-medium text-ink">{rowLabel(row)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-medium ${STATUS_CLASS[row.status]}`}
                    >
                      {statusLabel(row)}
                    </span>
                  </td>
                  {columns.length > 0 ? (
                    columns.map((column) => {
                      const isProblem = row.problemFields.includes(column.key);
                      return (
                        <td key={`${row.id}-${column.key}`} className="px-3 py-2">
                          {editingRowId === row.id && !readOnly ? (
                            <Input
                              value={
                                row.values[column.key] === null ||
                                row.values[column.key] === undefined
                                  ? ''
                                  : String(row.values[column.key])
                              }
                              onChange={(event) =>
                                updateNormalizationRowValue(row.id, column.key, event.target.value)
                              }
                              disabled={readOnly || isSubmittingNormalizationDecision}
                              className={`h-7 min-w-24 ${
                                isProblem ? 'border-danger-border bg-danger-tint' : ''
                              }`}
                            />
                          ) : (
                            <span
                              className={
                                isProblem
                                  ? 'inline-flex min-h-7 min-w-20 items-center rounded-md border border-danger-border bg-danger-tint px-2 text-danger-ink'
                                  : 'text-ink'
                              }
                            >
                              {displayValue(row.values[column.key])}
                            </span>
                          )}
                        </td>
                      );
                    })
                  ) : (
                    <td className="px-3 py-2 text-ink-subtle">—</td>
                  )}
                  <td className="px-3 py-2 text-ink-subtle">
                    {row.duplicateOfRowId ? (
                      <span>Duplicate of {row.duplicateOfRowId}</span>
                    ) : (
                      row.issueDetail
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.editable && row.decision !== 'skipped' && !readOnly ? (
                      <select
                        className="h-8 rounded-md border border-hairline bg-surface-1 px-2 text-caption font-medium text-ink"
                        value={row.decision}
                        disabled={readOnly || isSubmittingNormalizationDecision}
                        onChange={(event) =>
                          updateNormalizationRowDecision(
                            row.id,
                            event.target.value as Extract<
                              NormalizationReviewRow['decision'],
                              'keep_row' | 'skip_row'
                            >,
                          )
                        }
                      >
                        <option value="keep_row">Keep row</option>
                        <option value="skip_row">Skip row</option>
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface-1 px-2 py-1 font-medium text-ink">
                        {row.decision === 'keep_row' ? (
                          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                        ) : (
                          <CircleSlash className="size-3.5 text-danger" aria-hidden />
                        )}
                        {DECISION_LABEL[row.decision]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.editable && !readOnly ? (
                      editingRowId === row.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            disabled={readOnly || isSubmittingNormalizationDecision}
                            onClick={() => setEditingRowId(null)}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={readOnly || isSubmittingNormalizationDecision}
                            onClick={() => {
                              resetNormalizationRowOverrides(row.id);
                              setEditingRowId(null);
                            }}
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={readOnly || isSubmittingNormalizationDecision}
                          onClick={() => setEditingRowId(row.id)}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          Modify
                        </Button>
                      )
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </FragmentLike>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentLike(props: { children: React.ReactNode }) {
  return <>{props.children}</>;
}

function ReviewBySheet(props: {
  groups: NormalizationReviewTableGroup[];
  readOnly: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateNormalizationRowDecision: PmoNormalizationReviewPanelProps['updateNormalizationRowDecision'];
  updateNormalizationRowValue: PmoNormalizationReviewPanelProps['updateNormalizationRowValue'];
  resetNormalizationRowOverrides: PmoNormalizationReviewPanelProps['resetNormalizationRowOverrides'];
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(props.groups[0]?.tableId ? [props.groups[0].tableId] : []),
  );

  if (props.groups.length === 0) return null;

  return (
    <section className="mt-4">
      <div>
        <h4 className="text-body-sm font-semibold text-ink">Review by sheet</h4>
        <p className="mt-1 text-caption text-ink-subtle">
          Issue rows are grouped by table, then by issue type. Duplicate groups are kept together.
        </p>
      </div>
      <div className="mt-3 space-y-2">
        {props.groups.map((group) => {
          const isOpen = openGroups.has(group.tableId);
          return (
            <div
              key={group.tableId}
              className="overflow-hidden rounded-lg border border-hairline bg-surface-1"
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                onClick={() => {
                  setOpenGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group.tableId)) next.delete(group.tableId);
                    else next.add(group.tableId);
                    return next;
                  });
                }}
              >
                {isOpen ? (
                  <ChevronDown className="size-4 text-ink-subtle" aria-hidden />
                ) : (
                  <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
                )}
                <span className="font-semibold text-ink">{group.tableId}</span>
                <Badge variant="secondary">{group.totals.issues} issues</Badge>
                <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-caption text-ink-subtle">
                  <span>Blocked: {group.totals.blocked}</span>
                  <span>Duplicates: {group.totals.duplicates}</span>
                  <span>Missing fields: {group.totals.missingFields}</span>
                  <span>Missing refs: {group.totals.missingRefs}</span>
                  <span>Skip: {group.totals.skipped}</span>
                </span>
              </button>
              {isOpen ? (
                <NormalizationIssueTable
                  group={group}
                  readOnly={props.readOnly}
                  isSubmittingNormalizationDecision={props.isSubmittingNormalizationDecision}
                  updateNormalizationRowDecision={props.updateNormalizationRowDecision}
                  updateNormalizationRowValue={props.updateNormalizationRowValue}
                  resetNormalizationRowOverrides={props.resetNormalizationRowOverrides}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LegacyKvGrid(props: { rows: Array<{ k: string; v: string }>; emptyLabel: string }) {
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

function MissingMembersEditor(props: {
  memberAdditionDrafts: MemberMasterAdditionDraft[];
  readOnly: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateMemberAdditionDraft: PmoNormalizationReviewPanelProps['updateMemberAdditionDraft'];
}) {
  if (props.memberAdditionDrafts.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-hairline bg-canvas p-3">
      <p className="text-caption font-medium text-ink">Add missing member master data</p>
      <p className="mt-1 text-caption text-ink-subtle">
        These member IDs were not found in the workbook member master sheet or active database.
      </p>

      <div className="mt-3 space-y-3">
        {props.memberAdditionDrafts.map((draft) => (
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
                  props.updateMemberAdditionDraft(draft.member_id, 'full_name', event.target.value)
                }
                disabled={props.readOnly || props.isSubmittingNormalizationDecision}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`member-department-${draft.member_id}`}>Department</Label>
              <Input
                id={`member-department-${draft.member_id}`}
                value={draft.department}
                onChange={(event) =>
                  props.updateMemberAdditionDraft(draft.member_id, 'department', event.target.value)
                }
                disabled={props.readOnly || props.isSubmittingNormalizationDecision}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`member-role-${draft.member_id}`}>Role title</Label>
              <Input
                id={`member-role-${draft.member_id}`}
                value={draft.role_title}
                onChange={(event) =>
                  props.updateMemberAdditionDraft(draft.member_id, 'role_title', event.target.value)
                }
                disabled={props.readOnly || props.isSubmittingNormalizationDecision}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PmoNormalizationReviewPanel(props: PmoNormalizationReviewPanelProps) {
  const {
    readOnly = false,
    selectedNormalizationApproval,
    normalizationApprovalsCount,
    selectedNormalizationView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision,
    updateMemberAdditionDraft,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
    approveNormalization,
    rejectNormalization,
  } = props;

  const metrics = useMemo(() => {
    const summaryRows = selectedNormalizationView?.summaryRows ?? [];
    const tableGroups = selectedNormalizationView?.tableGroups ?? [];
    const reviewRows = selectedNormalizationView?.reviewRows ?? [];
    const totalRows = tableGroups.reduce((sum, group) => sum + group.rows.length, 0);
    const blockingIssues =
      parseSummaryNumber(summaryRows, /blocking/i) ||
      reviewRows.filter((row) => row.status === 'blocked').length;
    const duplicates =
      parseSummaryNumber(summaryRows, /duplicate/i) ||
      reviewRows.filter((row) => row.status === 'duplicate').length;
    const missingFields =
      parseSummaryNumber(summaryRows, /missing required/i) ||
      reviewRows.filter((row) => row.issueType === 'missing_required').length;
    const missingRefs =
      parseSummaryNumber(summaryRows, /unresolved reference/i) ||
      reviewRows.filter((row) => row.issueType === 'missing_reference').length;
    const skipped = reviewRows.filter((row) => row.status === 'skipped').length;

    return {
      totalRows: totalRows || parseSummaryNumber(summaryRows, /rows/i),
      blockingIssues,
      duplicates,
      missingFields,
      missingRefs,
      skipped,
    };
  }, [selectedNormalizationView]);

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

  const isDecided = selectedNormalizationApproval.status !== 'pending';
  const isReadOnly = readOnly || isDecided;
  const missingMemberCount = selectedNormalizationView.missingMembers.length;
  const hasStructuredReview = selectedNormalizationView.tableGroups.length > 0;

  return (
    <>
      {isReadOnly ? (
        <div className="rounded-lg border border-hairline bg-surface-2/60 px-3 py-2 text-caption text-ink-subtle">
          This normalization review has been completed. Showing historical data (read-only).
        </div>
      ) : (
        <div className="rounded-lg border border-danger-border bg-danger-tint/60 px-3 py-2 text-caption text-danger-ink">
          Normalization review is required. Review issue rows grouped by table before staging
          continues.
        </div>
      )}

      <section className="rounded-lg border border-hairline bg-surface-1 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-body-sm font-semibold text-ink">Normalize to staging</h4>
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
                : 'Needs review'}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard
            label="Issue rows"
            value={metrics.totalRows}
            hint="Shown below"
            tone="neutral"
            icon={Database}
          />
          <SummaryCard
            label="Blocking issues"
            value={metrics.blockingIssues}
            hint="Must fix"
            tone="danger"
            icon={AlertCircle}
          />
          <SummaryCard
            label="Duplicates"
            value={metrics.duplicates}
            hint="Grouped by key"
            tone="warning"
            icon={Copy}
          />
          <SummaryCard
            label="Missing fields"
            value={metrics.missingFields}
            hint="Required values"
            tone="warning"
            icon={AlertCircle}
          />
          <SummaryCard
            label="Missing refs"
            value={metrics.missingRefs}
            hint="Reference not found"
            tone="purple"
            icon={Link2Off}
          />
          <SummaryCard
            label="Skipped rows"
            value={metrics.skipped}
            hint="Will not stage"
            tone="neutral"
            icon={CircleSlash}
          />
        </div>

        {hasStructuredReview ? (
          <ReviewBySheet
            groups={selectedNormalizationView.tableGroups}
            readOnly={isReadOnly}
            isSubmittingNormalizationDecision={isSubmittingNormalizationDecision}
            updateNormalizationRowDecision={updateNormalizationRowDecision}
            updateNormalizationRowValue={updateNormalizationRowValue}
            resetNormalizationRowOverrides={resetNormalizationRowOverrides}
          />
        ) : (
          <div className="mt-4">
            <LegacyKvGrid
              rows={selectedNormalizationView.summaryRows}
              emptyLabel="No normalization summary was provided."
            />
          </div>
        )}

        <MissingMembersEditor
          memberAdditionDrafts={memberAdditionDrafts}
          readOnly={isReadOnly}
          isSubmittingNormalizationDecision={isSubmittingNormalizationDecision}
          updateMemberAdditionDraft={updateMemberAdditionDraft}
        />

        {isReadOnly ? null : (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-hairline bg-canvas p-3">
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
        )}
      </section>
    </>
  );
}
