import { useRemoteThreadListRuntime } from '@assistant-ui/react';
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { mastraThreadListAdapter } from '../lib/mastra-thread-list-adapter';
import { buildPageContextPart } from '../lib/page-context-part';
import type { PageContext } from '../lib/page-context-types';

interface UseAgentRuntimeOpts {
  threadId?: string;
  modelKey?: string;
  initialMessages?: UIMessage[];
  /**
   * When provided, the runtime attaches a `data-page-context` part to outgoing
   * user messages whose context id is not equal to `suppressedFor`. The ref is
   * read at send time so updates from `<AgentProvider>` are picked up without
   * re-creating the runtime.
   */
  pageContextRef?: { current: { ctx: PageContext | null; suppressedFor: string | null } };
}

export function useAgentRuntime({
  threadId,
  modelKey,
  initialMessages,
  pageContextRef,
}: UseAgentRuntimeOpts) {
  const modelRef = useRef(modelKey);
  useEffect(() => {
    modelRef.current = modelKey;
  }, [modelKey]);

  const readBody = useCallback(() => {
    const m = modelRef.current;
    return m ? { model: m } : {};
  }, []);

  const transport = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- readBody captures modelRef and is only invoked when the transport sends; safe.
    return new AssistantChatTransport({
      api: '/api/agent/v1/chat',
      credentials: 'include',
      body: readBody,
    });
  }, [readBody]);

  const toCreateMessage = useCallback(
    (message: { role: string; content: ReadonlyArray<unknown> }) => {
      const parts: Array<{ type: string; [k: string]: unknown }> = [];
      for (const part of message.content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as { type?: unknown };
        if (p.type === 'text') {
          parts.push({ type: 'text', text: (part as { text: string }).text });
        } else if (p.type === 'image') {
          const img = part as { image: string; filename?: string };
          parts.push({
            type: 'file',
            url: img.image,
            mediaType: 'image/png',
            ...(img.filename ? { filename: img.filename } : {}),
          });
        } else if (p.type === 'file') {
          const f = part as { data: string; mimeType: string; filename?: string };
          parts.push({
            type: 'file',
            url: f.data,
            mediaType: f.mimeType,
            ...(f.filename ? { filename: f.filename } : {}),
          });
        }
      }

      const snap = pageContextRef?.current;
      if (message.role === 'user' && snap?.ctx && snap.suppressedFor !== snap.ctx.id) {
        parts.push(
          buildPageContextPart(snap.ctx) as unknown as { type: string; [k: string]: unknown },
        );
      }

      return { role: message.role as 'user', parts } as never;
    },
    [pageContextRef],
  );

  // Capture values needed inside the runtimeHook via refs so the hook
  // `initialMessages` is safe to close over directly: `AgentRuntimeHostInner`
  // remounts whenever the thread changes (key includes threadId), so
  // `initialMessages` is frozen for the full lifetime of this mount.
  // No ref needed — using a ref here caused the react-compiler linter to
  // flag every subsequent `opts.X` access as a "ref access during render".
  return useRemoteThreadListRuntime({
    adapter: mastraThreadListAdapter,
    threadId,
    runtimeHook: function MastraRuntimeHook() {
      // biome-ignore lint/correctness/useHookAtTopLevel: MastraRuntimeHook is a named React component passed as runtimeHook, not a nested function call
      return useChatRuntime({
        transport,
        ...(initialMessages ? { messages: initialMessages } : {}),
        toCreateMessage,
      });
    },
  });
}
