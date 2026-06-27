/**
 * Side drawer for detailed PMO step review. Opened from the "Review details"
 * button on PmoChatHitlCard. Renders structured detail views for each step
 * type, parsed from the approval payload.
 *
 * Uses view model parsers from pmo-page.logic.ts to extract structured data
 * from the raw approval payload. The drawer footer provides approve/reject
 * actions wired through useSubmitDecision.
 */
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@seta/shared-ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import {
  type MappingProgressItem,
  parseMappingView,
  parseNormalizationReviewView,
  parsePublishReviewView,
} from '../../../pmo/pages/pmo-page.logic.ts';
import { notifyApprovalResolved } from '../../hooks/use-approval-events.ts';
import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { useSubmitDecision } from '../hooks/use-submit-decision.ts';
import { workflowsQueryKeys } from '../state/query-keys.ts';
import { cardToolId } from './decided-approval.ts';

// ---------------------------------------------------------------------------
// Step label mapping
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  pmo_profileWorkbook: 'Workbook Profiling',
  pmo_confirmMapping: 'Column Mapping',
  pmo_reviewNormalization: 'Normalization Review',
  pmo_confirmPublish: 'Publish Review',
  pmo_confirmReportRange: 'Report Configuration',
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  pmo_profileWorkbook: 'Review detected sheets, areas, and confidence scores.',
  pmo_confirmMapping: 'Review and adjust column mappings for each detected table.',
  pmo_reviewNormalization: 'Review normalized data, resolve duplicates and missing references.',
  pmo_confirmPublish: 'Review change summary before publishing to canonical tables.',
  pmo_confirmReportRange: 'Configure date ranges and parameters for report generation.',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PmoStepReviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approval: WorkflowApprovalRow;
  stepType: string;
  threadId: string | undefined;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PmoStepReviewDrawer({
  open,
  onOpenChange,
  approval,
  stepType,
  threadId,
}: PmoStepReviewDrawerProps) {
  const qc = useQueryClient();
  const submit = useSubmitDecision();
  const toolId = stepType || cardToolId(approval.proposedPayload) || '';
  const stepLabel = TOOL_LABELS[toolId] ?? 'Review';
  const stepDescription = TOOL_DESCRIPTIONS[toolId] ?? 'Review the details and approve or reject.';

  const handleDecision = (decision: 'approve' | 'reject') => {
    submit.mutate(
      {
        approvalId: approval.approvalId,
        agentic: approval.agentic,
        decision,
      },
      {
        onSuccess: () => {
          notifyApprovalResolved({ threadId });
          if (threadId) {
            void qc.invalidateQueries({
              queryKey: workflowsQueryKeys.threadApprovals(threadId),
            });
          }
          void qc.invalidateQueries({ queryKey: workflowsQueryKeys.pendingApprovals() });
          const moduleNs = toolId.split('_')[0];
          if (moduleNs) void qc.invalidateQueries({ queryKey: [moduleNs] });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{stepLabel}</SheetTitle>
          <SheetDescription>{stepDescription}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 min-h-[200px]">
          <DrawerStepContent approval={approval} toolId={toolId} />
        </div>

        <SheetFooter className="mt-6 border-t border-hairline pt-4">
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={submit.isPending}
            onClick={() => handleDecision('approve')}
          >
            {submit.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={submit.isPending}
            onClick={() => handleDecision('reject')}
          >
            <XCircle className="size-4" />
            Reject
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Step content dispatcher
// ---------------------------------------------------------------------------

function DrawerStepContent({
  approval,
  toolId,
}: {
  approval: WorkflowApprovalRow;
  toolId: string;
}) {
  switch (toolId) {
    case 'pmo_confirmPublish':
      return <PublishContent approval={approval} />;
    case 'pmo_confirmMapping':
      return <MappingContent approval={approval} />;
    case 'pmo_reviewNormalization':
      return <NormalizationContent approval={approval} />;
    case 'pmo_profileWorkbook':
      return <ProfilingContent approval={approval} />;
    case 'pmo_confirmReportRange':
      return <ReportContent approval={approval} />;
    default:
      return <GenericContent approval={approval} />;
  }
}

// ---------------------------------------------------------------------------
// Publish drawer content
// ---------------------------------------------------------------------------

function PublishContent({ approval }: { approval: WorkflowApprovalRow }) {
  const view = parsePublishReviewView(approval);
  if (!view) return <GenericContent approval={approval} />;

  return (
    <div className="space-y-4">
      {view.summary ? <p className="text-body-sm text-ink">{view.summary}</p> : null}

      {view.summaryRows.length > 0 ? (
        <KvSection title="Change Summary" rows={view.summaryRows} />
      ) : null}

      {view.tableRows.length > 0 ? <KvSection title="Tables" rows={view.tableRows} /> : null}

      {view.issueRows.length > 0 ? <KvSection title="Issues" rows={view.issueRows} /> : null}

      {view.checklist.length > 0 ? (
        <div className="rounded-md border border-hairline bg-surface-1 p-3">
          <p className="mb-2 text-caption font-medium text-ink-subtle">Checklist</p>
          <ul className="space-y-1">
            {view.checklist.map((item) => (
              <li key={item} className="text-caption text-ink">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapping drawer content
// ---------------------------------------------------------------------------

function MappingContent({ approval }: { approval: WorkflowApprovalRow }) {
  const view = parseMappingView(approval);
  if (!view) return <GenericContent approval={approval} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-body-sm font-medium text-ink">
          Progress: {view.approved} / {view.total} columns mapped
        </span>
        <ProgressBar value={view.total > 0 ? view.approved / view.total : 0} />
      </div>

      {view.awaitingNextStep ? (
        <div className="rounded-md border border-semantic-success/30 bg-semantic-success/5 px-3 py-2 text-caption text-semantic-success">
          All columns mapped. Ready to proceed to the next step.
        </div>
      ) : null}

      <MappingTable items={view.items} />
    </div>
  );
}

function MappingTable({ items }: { items: MappingProgressItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-hairline">
      <table className="w-full text-caption">
        <thead>
          <tr className="border-b border-hairline bg-surface-1">
            <th className="px-3 py-2 text-left font-medium text-ink-subtle">Status</th>
            <th className="px-3 py-2 text-left font-medium text-ink-subtle">Table.Field</th>
            <th className="px-3 py-2 text-left font-medium text-ink-subtle">Source</th>
            <th className="px-3 py-2 text-right font-medium text-ink-subtle">Confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((item) => (
            <tr key={item.key} className={item.state === 'current' ? 'bg-primary-tint/20' : ''}>
              <td className="px-3 py-1.5">
                <MappingStateBadge state={item.state} />
              </td>
              <td className="px-3 py-1.5 font-medium text-ink">
                {item.table}.{item.field}
              </td>
              <td className="px-3 py-1.5 text-ink-subtle">
                {item.sourceColumn ?? '—'}
                {item.sourceSheet ? (
                  <span className="ml-1 text-[11px] text-ink-subtle">({item.sourceSheet})</span>
                ) : null}
              </td>
              <td className="px-3 py-1.5 text-right">
                {item.confidence ? (
                  <ConfidenceChip value={item.confidence} />
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Normalization drawer content
// ---------------------------------------------------------------------------

function NormalizationContent({ approval }: { approval: WorkflowApprovalRow }) {
  const view = parseNormalizationReviewView(approval);
  if (!view) return <GenericContent approval={approval} />;

  return (
    <div className="space-y-4">
      {view.summary ? <p className="text-body-sm text-ink">{view.summary}</p> : null}

      {view.summaryRows.length > 0 ? <KvSection title="Summary" rows={view.summaryRows} /> : null}

      {view.missingMembers.length > 0 ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="mb-2 text-caption font-medium text-warning">
            Missing members ({view.missingMembers.length})
          </p>
          <ul className="space-y-1">
            {view.missingMembers.map((m) => (
              <li key={m.memberId} className="text-caption text-ink">
                <span className="font-medium">{m.memberId}</span>
                <span className="text-ink-subtle">
                  {' '}
                  — {m.reason} (source: {m.source})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.tableGroups.map((group) => (
        <div key={group.tableId} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-body-sm font-medium text-ink">{group.tableId}</span>
            {group.sourceSheet ? (
              <span className="text-caption text-ink-subtle">({group.sourceSheet})</span>
            ) : null}
            <span className="ml-auto text-caption text-ink-subtle">
              {group.totals.issues} issues, {group.totals.blocked} blocked,{' '}
              {group.totals.duplicates} duplicates
            </span>
          </div>
          <NormalizationIssueTable rows={group.rows} />
        </div>
      ))}

      {view.issueRows.length > 0 ? <KvSection title="Issues" rows={view.issueRows} /> : null}
    </div>
  );
}

function NormalizationIssueTable({
  rows,
}: {
  rows: { id: string; issueLabel: string; issueDetail: string; status: string; decision: string }[];
}) {
  if (rows.length === 0) return null;
  const maxRows = 20;
  const displayRows = rows.slice(0, maxRows);
  return (
    <div className="overflow-x-auto rounded-md border border-hairline">
      <table className="w-full text-caption">
        <thead>
          <tr className="border-b border-hairline bg-surface-1">
            <th className="px-3 py-2 text-left font-medium text-ink-subtle">Issue</th>
            <th className="px-3 py-2 text-left font-medium text-ink-subtle">Detail</th>
            <th className="px-3 py-2 text-left font-medium text-ink-subtle">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {displayRows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-1.5 font-medium text-ink">{row.issueLabel}</td>
              <td className="max-w-[300px] truncate px-3 py-1.5 text-ink-subtle">
                {row.issueDetail}
              </td>
              <td className="px-3 py-1.5">
                <NormStatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows ? (
        <div className="border-t border-hairline px-3 py-1.5 text-caption text-ink-subtle">
          Showing {maxRows} of {rows.length} rows
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profiling drawer content (from card payload structure)
// ---------------------------------------------------------------------------

function ProfilingContent({ approval }: { approval: WorkflowApprovalRow }) {
  const payload = approval.proposedPayload as CardPayload | null;
  if (!payload) return <GenericContent approval={approval} />;

  const tables = (payload.details ?? []).filter(
    (d): d is { kind: 'kvTable'; rows: { k: string; v: string }[] } => d.kind === 'kvTable',
  );
  const candidates = (payload.details ?? []).filter(
    (d): d is { kind: 'candidateList'; items: { id: string; label: string; score?: number }[] } =>
      d.kind === 'candidateList',
  );

  return (
    <div className="space-y-4">
      {payload.summary ? <p className="text-body-sm text-ink">{payload.summary}</p> : null}

      {payload.agentNote ? (
        <div className="rounded-md border border-hairline bg-surface-1/50 px-3 py-2 text-caption text-ink-subtle">
          <span className="font-medium text-ink">Agent:</span> {payload.agentNote}
        </div>
      ) : null}

      {tables.map((table, idx) => (
        <KvSection
          key={table.rows[0]?.k ?? `table-${String(idx)}`}
          title={idx === 0 ? 'Session Details' : idx === 1 ? 'Data' : undefined}
          rows={table.rows}
        />
      ))}

      {candidates.map((cl, idx) => (
        <div key={`candidates-${String(idx)}`} className="rounded-md border border-hairline">
          <div className="border-b border-hairline bg-surface-1 px-3 py-1.5 text-caption font-medium text-ink-subtle">
            Detected tables
          </div>
          <div className="divide-y divide-hairline">
            {cl.items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-caption">
                <span className="font-medium text-ink">{item.label}</span>
                {typeof item.score === 'number' ? (
                  <div className="ml-auto flex items-center gap-1">
                    <ProgressBar value={item.score} className="w-16" />
                    <span className="text-[11px] text-ink-subtle">
                      {Math.round(item.score * 100)}%
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report drawer content
// ---------------------------------------------------------------------------

function ReportContent({ approval }: { approval: WorkflowApprovalRow }) {
  const payload = approval.proposedPayload as CardPayload | null;
  if (!payload) return <GenericContent approval={approval} />;

  const tables = (payload.details ?? []).filter(
    (d): d is { kind: 'kvTable'; rows: { k: string; v: string }[] } => d.kind === 'kvTable',
  );

  return (
    <div className="space-y-4">
      {payload.summary ? <p className="text-body-sm text-ink">{payload.summary}</p> : null}
      {tables.map((table, idx) => (
        <KvSection
          key={table.rows[0]?.k ?? `table-${String(idx)}`}
          title={idx === 0 ? 'Configuration' : undefined}
          rows={table.rows}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic fallback
// ---------------------------------------------------------------------------

function GenericContent({ approval }: { approval: WorkflowApprovalRow }) {
  const payload = approval.proposedPayload as Record<string, unknown> | null;
  const summary = typeof payload?.summary === 'string' ? payload.summary : 'No details available.';

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 p-4">
      <p className="text-body-sm text-ink">{summary}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

interface CardPayload {
  summary?: string;
  agentNote?: string;
  details?: Array<{ kind: string; [k: string]: unknown }>;
}

function KvSection({ title, rows }: { title?: string; rows: Array<{ k: string; v: string }> }) {
  return (
    <div className="rounded-md border border-hairline bg-surface-1">
      {title ? (
        <div className="border-b border-hairline px-3 py-1.5 text-caption font-medium text-ink-subtle">
          {title}
        </div>
      ) : null}
      <div className="divide-y divide-hairline">
        {rows.map((row) => (
          <div
            key={`${row.k}::${row.v}`}
            className="flex items-baseline gap-2 px-3 py-1.5 text-caption"
          >
            <span className="w-40 shrink-0 font-medium text-ink-subtle">{row.k}</span>
            <span className="min-w-0 flex-1 text-ink">{row.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 rounded-full bg-surface-3 ${className ?? 'w-24'}`}>
      <div
        className="h-full rounded-full bg-semantic-success"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}

function ConfidenceChip({ value }: { value: string }) {
  const num = Number.parseFloat(value);
  const color = Number.isNaN(num)
    ? 'bg-surface-2 text-ink-subtle'
    : num >= 0.8
      ? 'bg-semantic-success/10 text-semantic-success'
      : num >= 0.5
        ? 'bg-warning/10 text-warning'
        : 'bg-danger/10 text-danger';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>{value}</span>
  );
}

function MappingStateBadge({ state }: { state: 'approved' | 'pending' | 'current' }) {
  const styles = {
    approved: 'bg-semantic-success/10 text-semantic-success',
    current: 'bg-primary-tint text-primary',
    pending: 'bg-surface-2 text-ink-subtle',
  };
  const labels = { approved: 'Done', current: 'Current', pending: 'Pending' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

function NormStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    blocked: 'bg-danger/10 text-danger',
    duplicate: 'bg-warning/10 text-warning',
    warning: 'bg-warning/10 text-warning',
    skipped: 'bg-surface-2 text-ink-subtle',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status] ?? 'bg-surface-2 text-ink-subtle'}`}
    >
      {status}
    </span>
  );
}
