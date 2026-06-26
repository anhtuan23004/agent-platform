import { useQuery } from '@tanstack/react-query';
import { workflowsApi } from '../api/workflows.ts';
import { workflowsQueryKeys } from '../state/query-keys.ts';

/**
 * All approvals (pending + decided) of one chat thread. Decided rows are kept
 * so the in-thread card can render a persistent outcome row — unlike
 * usePendingApprovals, which is the cross-thread pending inbox.
 *
 * Polls every 4 s as a fallback: after /chat/resume the server may write a
 * new approval row (onApproval) AFTER the client-side invalidation fires
 * (the chat-panel resumeChat does not drain the SSE stream), so the one-shot
 * invalidation in HitlCardHost.onSuccess can miss the new row.
 */
export function useThreadApprovals(threadId: string | undefined) {
  return useQuery({
    queryKey: workflowsQueryKeys.threadApprovals(threadId ?? ''),
    queryFn: () => workflowsApi.listThreadApprovals(threadId as string),
    enabled: Boolean(threadId),
    refetchInterval: 4_000,
  });
}
