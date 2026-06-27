/**
 * PMO-specific HITL card rendered inside the chat transcript instead of the
 * generic HitlCard. Presents profiling, mapping, normalization, publish and
 * report-range data in a structured, styled card with Approve/Decline buttons.
 *
 * Interaction logic (approve → resumeChat → agent resume) is identical to
 * HitlCardHost — only the visual presentation differs.
 */
import { Button } from '@seta/shared-ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, Sparkles, XCircle } from 'lucide-react';
import { useState } from 'react';
import { notifyApprovalResolved } from '../../hooks/use-approval-events.ts';
import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { useSubmitDecision } from '../hooks/use-submit-decision.ts';
import { workflowsQueryKeys } from '../state/query-keys.ts';
import { cardToolId } from './decided-approval.ts';
import { PmoStepReviewDrawer } from './pmo-step-review-drawer.tsx';

// ---------------------------------------------------------------------------
// Payload parsing helpers
// ---------------------------------------------------------------------------

interface KvRow {
  k: string;
  v: string;
}

interface KvTable {
  kind: 'kvTable';
  rows: KvRow[];
}

type DetailBlock = KvTable | { kind: string };

interface CardPayload {
  intent?: string;
  summary?: string;
  agentNote?: string;
  riskBadge?: string;
  details?: DetailBlock[];
  primary?: { label: string };
  alternates?: Array<{ label: string }>;
  decline?: { label: string };
  meta?: { toolId?: string };
}

function parsePayload(raw: unknown): CardPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as CardPayload;
}

function kvTables(card: CardPayload): KvTable[] {
  return (card.details ?? []).filter((d): d is KvTable => d.kind === 'kvTable');
}

function kvGet(rows: KvRow[], key: string): string | undefined {
  return rows.find((r) => r.k.toLowerCase() === key.toLowerCase())?.v;
}

// ---------------------------------------------------------------------------
// Tool-ID label mapping
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  pmo_profileWorkbook: 'Workbook Profiling',
  pmo_confirmMapping: 'Column Mapping',
  pmo_reviewNormalization: 'Normalization Review',
  pmo_confirmPublish: 'Publish Review',
  pmo_confirmReportRange: 'Report Configuration',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidenceBadge({ value }: { value: string }) {
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface PmoChatHitlCardProps {
  approval: WorkflowApprovalRow;
  canAct: boolean;
  threadId: string | undefined;
}

export function PmoChatHitlCard({ approval, canAct, threadId }: PmoChatHitlCardProps) {
  const qc = useQueryClient();
  const submit = useSubmitDecision();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const card = parsePayload(approval.proposedPayload);
  if (!card) return null;

  const toolId = card.meta?.toolId ?? cardToolId(approval.proposedPayload) ?? '';
  const stepLabel = TOOL_LABELS[toolId] ?? card.intent ?? 'Review';

  // Extract key fields from first KV table (session info)
  const infoTable = kvTables(card)[0];
  const confidence = infoTable ? kvGet(infoTable.rows, 'Workbook confidence') : undefined;
  const validationStatus = infoTable ? kvGet(infoTable.rows, 'Validation status') : undefined;

  const handleDecision = (decision: 'approve' | 'reject') => {
    const alternateIndices = decision === 'approve' ? undefined : undefined;
    submit.mutate(
      {
        approvalId: approval.approvalId,
        agentic: approval.agentic,
        decision,
        alternateIndices,
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
        },
      },
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-canvas shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-hairline bg-surface-1 px-4 py-2.5">
        <Sparkles className="size-4 text-brand" />
        <span className="text-body-sm font-semibold text-ink">{stepLabel}</span>
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium uppercase text-warning">
          {card.riskBadge ?? 'write'}
        </span>
        {confidence ? (
          <div className="ml-auto">
            <ConfidenceBadge value={confidence} />
          </div>
        ) : null}
      </div>

      {/* Agent note */}
      {card.agentNote ? (
        <div className="border-b border-hairline bg-surface-1/50 px-4 py-2 text-caption text-ink-subtle">
          <span className="font-medium text-ink">Agent:</span> {card.agentNote}
        </div>
      ) : null}

      {/* Body — compact summary only; full details in the drawer */}
      <div className="space-y-2 px-4 py-3">
        {card.summary ? <p className="text-body-sm text-ink line-clamp-3">{card.summary}</p> : null}

        {validationStatus ? (
          <div className="flex items-center gap-2">
            <span className="text-caption text-ink-subtle">Status:</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                validationStatus === 'confirmed'
                  ? 'bg-semantic-success/10 text-semantic-success'
                  : validationStatus === 'blocked'
                    ? 'bg-danger/10 text-danger'
                    : 'bg-warning/10 text-warning'
              }`}
            >
              {validationStatus}
            </span>
          </div>
        ) : null}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 border-t border-hairline px-4 py-3">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={!canAct || submit.isPending}
          onClick={() => handleDecision('approve')}
        >
          {submit.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {card.primary?.label ?? 'Approve'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canAct || submit.isPending}
          onClick={() => setDrawerOpen(true)}
        >
          <ExternalLink className="size-4" />
          Review details
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canAct || submit.isPending}
          onClick={() => handleDecision('reject')}
        >
          <XCircle className="size-4" />
          {card.decline?.label ?? 'Reject'}
        </Button>
      </div>

      {/* Drawer for detailed review */}
      <PmoStepReviewDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        approval={approval}
        stepType={toolId}
        threadId={threadId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detector: does this approval belong to a PMO ingest tool?
// ---------------------------------------------------------------------------

const PMO_INGEST_TOOL_IDS = new Set([
  'pmo_profileWorkbook',
  'pmo_confirmMapping',
  'pmo_reviewNormalization',
  'pmo_confirmPublish',
  'pmo_confirmReportRange',
]);

export function isPmoIngestApproval(approval: WorkflowApprovalRow): boolean {
  const id = cardToolId(approval.proposedPayload);
  return id !== null && PMO_INGEST_TOOL_IDS.has(id);
}
