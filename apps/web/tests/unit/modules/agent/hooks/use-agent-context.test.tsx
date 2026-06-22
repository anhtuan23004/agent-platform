import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
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

import { AgentProvider, usePageContext } from '@/modules/agent/chat-experience/agent-provider';
import { useAgentContext } from '@/modules/agent/hooks/use-agent-context';
import type { PageContext } from '@/modules/agent/lib/page-context-types';

type Snap = PageContext | null;

function Probe({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AgentProvider>{children}</AgentProvider>
    </QueryClientProvider>
  );
}

function ContextEmitter({ kind, id, label }: { kind: string; id: string; label: string }) {
  useAgentContext({ kind, id, label });
  return null;
}

function ContextProbe({ onSnapshot }: { onSnapshot: (ctx: Snap) => void }) {
  const { pageContext } = usePageContext();
  onSnapshot(pageContext);
  return null;
}

describe('useAgentContext', () => {
  it('writes pageContext on mount and clears on unmount', () => {
    let snap: Snap = null;
    const { unmount } = render(
      <Probe>
        <ContextEmitter kind="planner.task" id="t1" label="X" />
        <ContextProbe
          onSnapshot={(v) => {
            snap = v;
          }}
        />
      </Probe>,
    );
    expect((snap as Snap)?.id).toBe('t1');
    unmount();
    // remount probe alone — fresh provider, no emitter ⇒ null
    render(
      <Probe>
        <ContextProbe
          onSnapshot={(v) => {
            snap = v;
          }}
        />
      </Probe>,
    );
    expect(snap).toBeNull();
  });

  it('last writer wins when two emitters mount', () => {
    let snap: Snap = null;
    render(
      <Probe>
        <ContextEmitter kind="planner.group" id="g1" label="G" />
        <ContextEmitter kind="planner.task" id="t1" label="T" />
        <ContextProbe
          onSnapshot={(v) => {
            snap = v;
          }}
        />
      </Probe>,
    );
    expect((snap as Snap)?.kind).toBe('planner.task');
  });
});
