import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import type { ChatAgentMode } from '../api/schemas';

export interface ThreadMessagesResponse {
  thread: { id: string; title: string | null; updatedAt: string | null; chatAgent?: ChatAgentMode };
  messages: UIMessage[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export class ThreadMessagesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ThreadMessagesError';
  }
}

async function fetchMessages(
  threadId: string,
  agent?: ChatAgentMode,
  page = 0,
  perPage = 50,
): Promise<ThreadMessagesResponse> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (agent) params.set('agent', agent);
  const url = `/api/agent/v1/threads/${encodeURIComponent(threadId)}?${params.toString()}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new ThreadMessagesError(res.status, `thread messages ${res.status}`);
  return (await res.json()) as ThreadMessagesResponse;
}

export function useThreadMessages(threadId: string | undefined, agent?: ChatAgentMode) {
  return useQuery({
    queryKey: ['agent', 'thread', threadId, agent ?? 'all'],
    queryFn: () => {
      if (!threadId) throw new Error('threadId required');
      return fetchMessages(threadId, agent);
    },
    enabled: Boolean(threadId),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    // A 404 is the legitimate "thread row hasn't been created yet" signal for a
    // client-minted id. Don't churn the network on it.
    retry: (failureCount, error) => {
      if (error instanceof ThreadMessagesError && error.status === 404) return false;
      return failureCount < 3;
    },
  });
}
