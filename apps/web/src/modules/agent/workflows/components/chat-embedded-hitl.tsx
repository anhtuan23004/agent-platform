import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { type DecideApprovalBody, workflowsApi } from '../api/workflows.ts';
import { useThreadApprovals } from '../hooks/use-thread-approvals.ts';
import { workflowsQueryKeys } from '../state/query-keys.ts';
import { isDedupApprovalPayload } from './approval-card-shape.ts';
import { cardToolId } from './decided-approval.ts';
import {
  type ApprovalStatusOverride,
  partitionThreadApprovals,
} from './decided-approval-history.logic.ts';
import { DecidedApprovalHistoryGroup } from './decided-approval-history-group.tsx';
import { DecidedApprovalRow } from './decided-approval-row.tsx';
import { HitlApprovalCard } from './hitl-approval-card.tsx';
import { HitlCardHost } from './hitl-card-host.tsx';
import { isPmoIngestApproval, PmoChatHitlCard } from './pmo-chat-hitl-card.tsx';

export interface ChatEmbeddedHitlProps {
  threadId: string | undefined;
}

export function ChatEmbeddedHitl({ threadId }: ChatEmbeddedHitlProps) {
  const approvalsQuery = useThreadApprovals(threadId);
  const queryClient = useQueryClient();
  const [statusOverrides, setStatusOverrides] = useState<Map<string, ApprovalStatusOverride>>(
    () => new Map(),
  );

  const rememberDecision = useCallback(
    (approvalId: string, status: WorkflowApprovalRow['status'], decision: string) => {
      setStatusOverrides((current) => {
        const next = new Map(current);
        next.set(approvalId, {
          status,
          decisionPayload: { decision },
          decidedAt: new Date().toISOString(),
        });
        return next;
      });
    },
    [],
  );

  const decide = useMutation({
    mutationFn: (args: { approvalId: string; toolId: string | null } & DecideApprovalBody) =>
      workflowsApi.decideApproval(args.approvalId, {
        decision: args.decision,
        overrideUserIds: args.overrideUserIds,
        note: args.note,
      }),
    onSuccess: (_data, args) => {
      rememberDecision(
        args.approvalId,
        args.decision === 'approve'
          ? 'approved'
          : args.decision === 'modify'
            ? 'modified'
            : 'rejected',
        args.decision,
      );
      if (threadId) {
        void queryClient.invalidateQueries({
          queryKey: workflowsQueryKeys.threadApprovals(threadId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: workflowsQueryKeys.pendingApprovals() });
      const moduleNs = args.toolId?.split('_')[0];
      if (moduleNs) void queryClient.invalidateQueries({ queryKey: [moduleNs] });
    },
  });

  const handlePmoDecided = useCallback(
    (approvalId: string, status: 'approved' | 'rejected') => {
      rememberDecision(approvalId, status, status === 'approved' ? 'approve' : 'reject');
    },
    [rememberDecision],
  );

  const approvals = approvalsQuery.data;
  const { pmoDecided, pending, otherDecided } = useMemo(
    () => partitionThreadApprovals(approvals ?? [], statusOverrides),
    [approvals, statusOverrides],
  );

  if (!approvals || approvals.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="In-thread approvals">
      {pmoDecided.length > 0 ? <DecidedApprovalHistoryGroup approvals={pmoDecided} /> : null}

      {pending.map((approval) => {
        if (isDedupApprovalPayload(approval.proposedPayload)) {
          return (
            <HitlApprovalCard
              key={approval.approvalId}
              approval={approval}
              canAct
              pending={decide.isPending && decide.variables?.approvalId === approval.approvalId}
              onDecide={(args) =>
                decide.mutate({
                  approvalId: approval.approvalId,
                  toolId: cardToolId(approval.proposedPayload),
                  ...args,
                })
              }
            />
          );
        }
        if (isPmoIngestApproval(approval)) {
          return (
            <PmoChatHitlCard
              key={approval.approvalId}
              approval={approval}
              canAct
              threadId={threadId}
              onDecided={handlePmoDecided}
            />
          );
        }
        return (
          <HitlCardHost key={approval.approvalId} approval={approval} canAct threadId={threadId} />
        );
      })}

      {otherDecided.map((approval) => (
        <DecidedApprovalRow key={approval.approvalId} approval={approval} />
      ))}
    </section>
  );
}
