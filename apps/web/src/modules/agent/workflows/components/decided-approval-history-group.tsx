import { CheckCircle2, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { pmoHistorySummary } from './decided-approval-history.logic.ts';
import { DecidedApprovalRow } from './decided-approval-row.tsx';

export interface DecidedApprovalHistoryGroupProps {
  approvals: WorkflowApprovalRow[];
}

/** One collapsed summary line for many completed PMO steps; expand to browse each step. */
export function DecidedApprovalHistoryGroup({ approvals }: DecidedApprovalHistoryGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = pmoHistorySummary(approvals);

  if (approvals.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface-1">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-surface-2/60"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <CheckCircle2 className="mt-px size-4 shrink-0 text-semantic-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium text-ink">{summary.title}</p>
          {!expanded ? (
            <p className="mt-0.5 truncate text-caption text-ink-subtle">{summary.hint}</p>
          ) : null}
        </div>
        <ChevronDown
          className={`mt-0.5 size-4 shrink-0 text-ink-subtle transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-hairline px-3.5 py-2.5">
          {approvals.map((approval) => (
            <DecidedApprovalRow key={approval.approvalId} approval={approval} defaultCollapsed />
          ))}
        </div>
      ) : null}
    </div>
  );
}
