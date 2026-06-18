import { Button } from '@seta/shared-ui';
import {
  AlertCircle,
  CheckCircle2,
  CirclePlus,
  Database,
  Info,
  PencilLine,
  SkipForward,
  Table2,
  TriangleAlert,
} from 'lucide-react';
import type { ComponentType } from 'react';
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

interface PublishTotals {
  publish: number;
  skip: number;
  newRows: number;
  overwrite: number;
  blocking: number;
}

interface PublishScopeRow extends PublishTotals {
  scope: string;
}

interface MetricCardProps {
  label: string;
  value: number;
  hint?: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  tone: 'blue' | 'green' | 'orange' | 'purple' | 'red';
}

const TONE = {
  blue: {
    icon: 'border-primary-border bg-primary-tint text-primary',
    value: 'text-primary',
  },
  green: {
    icon: 'border-success-border bg-success-tint text-success',
    value: 'text-success',
  },
  orange: {
    icon: 'border-warning-border bg-warning-tint text-warning',
    value: 'text-warning',
  },
  purple: {
    icon: 'border-violet-100 bg-violet-50 text-violet-700',
    value: 'text-violet-700',
  },
  red: {
    icon: 'border-danger-border bg-danger-tint text-danger',
    value: 'text-danger',
  },
} as const;

function parseCount(value: string | null | undefined): number {
  if (!value) return 0;
  const match = value.replaceAll(',', '').match(/-?\d+/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readSummaryCount(rows: Array<{ k: string; v: string }>, matcher: RegExp): number {
  const row = rows.find((item) => matcher.test(item.k));
  return parseCount(row?.v);
}

function parsePublishScopeRows(
  tableRows: Array<{ k: string; v: string }>,
  issueRows: Array<{ k: string; v: string }>,
): PublishScopeRow[] {
  return tableRows.map((row) => {
    const fields = new Map<string, number>();
    for (const part of row.v.split('|')) {
      const [key, rawValue] = part.split('=').map((item) => item.trim());
      if (!key || rawValue == null) continue;
      fields.set(key, parseCount(rawValue));
    }

    const blocking = issueRows.filter((issue) =>
      `${issue.k} ${issue.v}`.toLowerCase().includes(row.k.toLowerCase()),
    ).length;

    return {
      scope: row.k,
      publish: fields.get('publish') ?? 0,
      skip: fields.get('skip_existing') ?? 0,
      newRows: fields.get('new') ?? 0,
      overwrite: fields.get('overwrite') ?? 0,
      blocking,
    };
  });
}

function buildTotals(view: PublishReviewViewModel, scopeRows: PublishScopeRow[]): PublishTotals {
  const fallback = scopeRows.reduce(
    (acc, row) => ({
      publish: acc.publish + row.publish,
      skip: acc.skip + row.skip,
      newRows: acc.newRows + row.newRows,
      overwrite: acc.overwrite + row.overwrite,
      blocking: acc.blocking + row.blocking,
    }),
    { publish: 0, skip: 0, newRows: 0, overwrite: 0, blocking: 0 },
  );

  const publish = readSummaryCount(view.summaryRows, /rows to publish/i) || fallback.publish;
  const skip = readSummaryCount(view.summaryRows, /rows to skip/i) || fallback.skip;
  const newRows = readSummaryCount(view.summaryRows, /new rows/i) || fallback.newRows;
  const overwrite =
    readSummaryCount(view.summaryRows, /rows to overwrite|overwrite/i) || fallback.overwrite;
  const blocking =
    readSummaryCount(view.summaryRows, /blocking issues/i) ||
    view.issueRows.length ||
    fallback.blocking;

  return { publish, skip, newRows, overwrite, blocking };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function MetricCard({ label, value, hint, icon: Icon, tone }: MetricCardProps) {
  const palette = TONE[tone];
  return (
    <div className="rounded-lg border border-hairline bg-surface-1 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg border p-2 ${palette.icon}`}>
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-ink-subtle">{label}</p>
          <p className={`mt-1 text-title-sm font-semibold ${palette.value}`}>
            {formatCount(value)}
          </p>
          {hint ? <p className="mt-1 text-caption text-ink-subtle">{hint}</p> : null}
        </div>
      </div>
    </div>
  );
}

function PublishScopeTable(props: { rows: PublishScopeRow[] }) {
  if (props.rows.length === 0) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed text-left text-caption">
          <thead className="bg-surface-1 text-ink">
            <tr className="border-b border-hairline">
              <th className="w-56 px-4 py-2.5 font-semibold">Scope</th>
              <th className="px-4 py-2.5 text-center font-semibold">New (insert)</th>
              <th className="px-4 py-2.5 text-center font-semibold">Overwrite (update)</th>
              <th className="px-4 py-2.5 text-center font-semibold">Skip (unchanged)</th>
              <th className="px-4 py-2.5 text-center font-semibold">Blocking issues</th>
              <th className="px-4 py-2.5 text-center font-semibold">Total to publish</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.scope} className="border-b border-hairline last:border-b-0">
                <td className="px-4 py-2.5 font-semibold text-ink">
                  <span className="inline-flex items-center gap-2">
                    <Table2 className="size-4 text-ink-subtle" aria-hidden />
                    {row.scope}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center font-semibold text-success">
                  {formatCount(row.newRows)}
                </td>
                <td className="px-4 py-2.5 text-center font-semibold text-warning">
                  {formatCount(row.overwrite)}
                </td>
                <td className="px-4 py-2.5 text-center font-semibold text-primary">
                  {formatCount(row.skip)}
                </td>
                <td className="px-4 py-2.5 text-center font-semibold text-danger">
                  {formatCount(row.blocking)}
                </td>
                <td className="px-4 py-2.5 text-center font-semibold text-primary">
                  {formatCount(row.publish)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PublishLegend() {
  const items = [
    {
      color: 'bg-success',
      label: 'New (insert)',
      text: 'New rows will be inserted.',
    },
    {
      color: 'bg-warning',
      label: 'Overwrite (update)',
      text: 'Existing PMO rows with same business key will be updated.',
    },
    {
      color: 'bg-primary',
      label: 'Skip (unchanged)',
      text: 'Rows already present with same business key will be skipped.',
    },
    {
      color: 'bg-danger',
      label: 'Blocking issues',
      text: 'Rows with errors prevent publishing.',
    },
  ];

  return (
    <div className="mt-4 flex gap-3 rounded-lg border border-primary-border bg-primary-tint/20 p-3">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="grid flex-1 gap-2 text-caption text-ink-subtle md:grid-cols-2">
        {items.map((item) => {
          const bulletClass = item.color === 'bg-primary' ? 'bg-violet-700' : item.color;
          return (
            <div key={item.label} className="flex items-start gap-2">
              <span className={`mt-1.5 size-1.5 rounded-full ${bulletClass}`} />
              <p>
                <span className="font-semibold text-ink">{item.label}:</span> {item.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
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

  const isDecided = selectedPublishApproval.status !== 'pending';
  const isReadOnly = readOnly || isDecided;
  const actionsDisabled = isSubmittingPublishDecision || isDecided;
  const scopeRows = parsePublishScopeRows(
    selectedPublishView.tableRows,
    selectedPublishView.issueRows,
  );
  const totals = buildTotals(selectedPublishView, scopeRows);
  const statusLabel = selectedPublishView.canApprove ? 'Ready to publish' : 'Blocked';
  const reviewStatusLabel = isReadOnly ? 'Publish review: Completed' : 'Publish review: Pending';

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border border-warning-border bg-warning-tint/70 px-4 py-3 text-warning-ink">
        <AlertCircle className="size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Publish review is required</p>
          <p className="mt-0.5 text-caption text-ink-subtle">
            The workflow can publish only after PMO approves this step.
          </p>
        </div>
        <span className="rounded-full bg-warning-tint px-3 py-1 text-caption font-semibold text-warning-ink">
          {reviewStatusLabel}
        </span>
      </div>

      <section className="rounded-lg border border-hairline bg-surface-1 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-body font-semibold text-ink">Review staging changes</h4>
            <p className="mt-1 text-ink-subtle">{selectedPublishView.summary}</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-semibold ${
              selectedPublishView.canApprove
                ? 'bg-success-tint text-success-ink'
                : 'bg-danger-tint text-danger-ink'
            }`}
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Rows to publish (new + overwrite)"
            value={totals.publish}
            hint={`New: ${formatCount(totals.newRows)} • Overwrite: ${formatCount(totals.overwrite)}`}
            icon={Database}
            tone="blue"
          />
          <MetricCard
            label="New rows (insert)"
            value={totals.newRows}
            icon={CirclePlus}
            tone="green"
          />
          <MetricCard
            label="Rows to overwrite (update)"
            value={totals.overwrite}
            icon={PencilLine}
            tone="orange"
          />
          <MetricCard
            label="Rows to skip (unchanged)"
            value={totals.skip}
            icon={SkipForward}
            tone="purple"
          />
          <MetricCard
            label="Blocking issues"
            value={totals.blocking}
            icon={TriangleAlert}
            tone="red"
          />
        </div>

        <PublishScopeTable rows={scopeRows} />

        {selectedPublishView.issueRows.length > 0 ? (
          <div className="mt-4 rounded-lg border border-danger-border bg-danger-tint/50 p-3">
            <p className="flex items-center gap-2 text-caption font-semibold text-danger-ink">
              <TriangleAlert className="size-4" aria-hidden />
              Blocking issues
            </p>
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

        <PublishLegend />

        {isReadOnly ? null : (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={actionsDisabled}
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
              disabled={actionsDisabled}
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
