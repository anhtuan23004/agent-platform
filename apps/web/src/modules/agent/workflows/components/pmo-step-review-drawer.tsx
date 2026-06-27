/**
 * Side drawer for detailed PMO step review. Opened from the "Review details"
 * button on PmoChatHitlCard. Renders the actual PMO panel components with
 * full interactive editing for each step type.
 *
 * Steps with embedded approve/reject buttons (mapping, normalization, profiling)
 * hide the drawer footer to avoid duplicate action buttons. Steps without
 * embedded buttons (publish, report) show the drawer footer.
 */
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@seta/shared-ui';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { notifyApprovalResolved } from '../../hooks/use-approval-events.ts';
import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { workflowsQueryKeys } from '../state/query-keys.ts';
import { cardToolId } from './decided-approval.ts';
import {
  pmoReviewDrawerClassName,
  pmoReviewDrawerOverlayClassName,
} from './pmo-chat-hitl-card.logic.ts';
import {
  DrawerMapping,
  DrawerNormalization,
  DrawerProfiling,
  DrawerPublish,
  DrawerReport,
} from './pmo-drawers/index.ts';

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
  approval: WorkflowApprovalRow | null;
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
  const toolId = stepType || (approval ? cardToolId(approval.proposedPayload) : '') || '';
  const stepLabel = TOOL_LABELS[toolId] ?? 'Review';
  const stepDescription = TOOL_DESCRIPTIONS[toolId] ?? 'Review the details and approve or reject.';

  const invalidateAfterDecision = useCallback(async () => {
    notifyApprovalResolved({ threadId });
    if (threadId) {
      await qc.invalidateQueries({ queryKey: workflowsQueryKeys.threadApprovals(threadId) });
    }
    void qc.invalidateQueries({ queryKey: workflowsQueryKeys.pendingApprovals() });
    const moduleNs = toolId.split('_')[0];
    if (moduleNs) void qc.invalidateQueries({ queryKey: [moduleNs] });
  }, [threadId, qc, toolId]);

  const handlePartialRefresh = useCallback(async () => {
    await invalidateAfterDecision();
  }, [invalidateAfterDecision]);

  const handleDecisionComplete = useCallback(async () => {
    await invalidateAfterDecision();
    onOpenChange(false);
  }, [invalidateAfterDecision, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={pmoReviewDrawerClassName()}
        overlayClassName={pmoReviewDrawerOverlayClassName()}
      >
        <SheetHeader className="shrink-0 border-b border-hairline px-6 py-4">
          <SheetTitle>{stepLabel}</SheetTitle>
          <SheetDescription>{stepDescription}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {open ? (
            approval ? (
              <DrawerStepContent
                approval={approval}
                toolId={toolId}
                threadId={threadId}
                onPartialRefresh={handlePartialRefresh}
                onDecisionComplete={handleDecisionComplete}
              />
            ) : (
              <div className="flex items-center justify-center gap-2 py-16 text-body-sm text-ink-subtle">
                <Loader2 className="size-4 animate-spin" />
                Loading review data…
              </div>
            )
          ) : null}
        </div>
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
  threadId,
  onPartialRefresh,
  onDecisionComplete,
}: {
  approval: WorkflowApprovalRow;
  toolId: string;
  threadId: string | undefined;
  onPartialRefresh: () => Promise<void>;
  onDecisionComplete: () => Promise<void>;
}) {
  switch (toolId) {
    case 'pmo_confirmMapping':
      return (
        <DrawerMapping
          approval={approval}
          threadId={threadId}
          onPartialRefresh={onPartialRefresh}
          onDecisionComplete={onDecisionComplete}
        />
      );
    case 'pmo_reviewNormalization':
      return <DrawerNormalization approval={approval} onDecisionComplete={onDecisionComplete} />;
    case 'pmo_confirmPublish':
      return <DrawerPublish approval={approval} onDecisionComplete={onDecisionComplete} />;
    case 'pmo_profileWorkbook':
      return (
        <DrawerProfiling
          approval={approval}
          threadId={threadId}
          onDecisionComplete={onDecisionComplete}
        />
      );
    case 'pmo_confirmReportRange':
      return <DrawerReport approval={approval} onDecisionComplete={onDecisionComplete} />;
    default:
      return <GenericContent approval={approval} />;
  }
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
