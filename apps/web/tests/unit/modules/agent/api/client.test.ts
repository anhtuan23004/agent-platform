import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentApi } from '@/modules/agent/api/client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agentApi', () => {
  it('listThreads parses the JSON response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              threads: [{ id: 't1', title: 'x', updatedAt: '2026-05-20T00:00:00Z' }],
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const out = await agentApi.listThreads();
    expect(out[0]?.id).toBe('t1');
  });

  it('passes the selected chat agent as a history filter', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ threads: [] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await agentApi.listThreads('pmo');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/agent/v1/threads?agent=pmo',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
