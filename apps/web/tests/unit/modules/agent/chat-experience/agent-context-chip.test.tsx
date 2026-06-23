import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/planner' }),
  useRouterState: (options?: { select?: (state: { location: { pathname: string } }) => unknown }) =>
    options?.select?.({ location: { pathname: '/planner' } }) ?? {
      location: { pathname: '/planner' },
    },
}));

vi.mock('@/modules/agent/hooks/use-model-catalog', () => ({
  useModelCatalog: () => ({
    data: {
      default: 'auto',
      models: [{ key: 'auto', label: 'Auto', tier: 'auto', supportsReasoning: false }],
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/modules/agent/hooks/use-agent-runtime', () => ({
  useAgentRuntime: () => ({ runtime: { kind: 'mock-runtime' } }),
}));

vi.mock('@/modules/agent/hooks/use-thread-messages', async () => {
  const actual = await vi.importActual<typeof import('@/modules/agent/hooks/use-thread-messages')>(
    '@/modules/agent/hooks/use-thread-messages',
  );
  return {
    ...actual,
    useThreadMessages: () => ({
      data: {
        thread: { id: 't', title: null, updatedAt: null },
        messages: [],
        page: 0,
        perPage: 0,
        total: 0,
        hasMore: false,
      },
      isLoading: false,
      error: null,
    }),
  };
});

import { AgentContextChip } from '@/modules/agent/chat-experience/agent-context-chip';
import { AgentProvider, usePageContext } from '@/modules/agent/chat-experience/agent-provider';

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AgentProvider>{children}</AgentProvider>
    </QueryClientProvider>
  );
}

function Setter({ kind, id, label }: { kind: string; id: string; label: string }) {
  const { setPageContext } = usePageContext();
  return (
    <button type="button" onClick={() => setPageContext({ kind, id, label })}>
      set
    </button>
  );
}

describe('AgentContextChip', () => {
  it('renders nothing when pageContext is null', () => {
    render(
      <Wrapper>
        <AgentContextChip />
      </Wrapper>,
    );
    expect(screen.queryByRole('button', { name: /detach context/i })).toBeNull();
  });

  it('renders label when pageContext is set, hides on detach', () => {
    render(
      <Wrapper>
        <Setter kind="planner.task" id="t1" label="Q3 launch" />
        <AgentContextChip />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByText(/Q3 launch/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /detach context/i }));
    expect(screen.queryByText(/Q3 launch/)).toBeNull();
  });
});
