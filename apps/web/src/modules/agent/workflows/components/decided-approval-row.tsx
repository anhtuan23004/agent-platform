import { CheckCircle2, ChevronDown, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { cardSummary, decidedStepTitle, outcomeText, STATUS_LABELS } from './decided-approval.ts';

export interface DecidedApprovalRowProps {
  approval: WorkflowApprovalRow;
  /** Collapsed by default keeps the chat transcript compact after a decision. */
  defaultCollapsed?: boolean;
}

export function DecidedApprovalRow({ approval, defaultCollapsed = true }: DecidedApprovalRowProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const label = STATUS_LABELS[approval.status] ?? approval.status;
  const stepTitle = decidedStepTitle(approval.proposedPayload);
  const positive = approval.status === 'approved' || approval.status === 'modified';
  const summary = cardSummary(approval.proposedPayload);
  const details = outcomeText(approval);
  const hasExpandableDetails = Boolean(summary && summary !== details);

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface-1">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-surface-2/60"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {positive ? (
          <CheckCircle2 className="mt-px size-4 shrink-0 text-semantic-success" aria-hidden />
        ) : (
          <XCircle className="mt-px size-4 shrink-0 text-ink-subtle" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-body-sm">
            <span className="font-medium text-ink">{label}</span>
            {stepTitle ? (
              <>
                <span className="text-ink-subtle" aria-hidden>
                  ·
                </span>
                <span className="truncate text-ink-subtle">{stepTitle}</span>
              </>
            ) : null}
          </div>
          {!expanded ? (
            <p className="mt-0.5 truncate text-caption text-ink-subtle">{details}</p>
          ) : null}
        </div>
        <ChevronDown
          className={`mt-0.5 size-4 shrink-0 text-ink-subtle transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="space-y-1 border-t border-hairline px-3.5 py-2.5 text-caption text-ink-subtle">
          <p>{details}</p>
          {hasExpandableDetails ? <p className="text-ink-subtle/90">{summary}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
