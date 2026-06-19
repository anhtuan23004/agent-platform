import { Sheet, SheetContent } from '@seta/shared-ui';
import { useEffect, useState } from 'react';
import { AgentComposer } from './chat-experience/agent-composer';
import { AgentHeader } from './chat-experience/agent-header';
import {
  type ChatAgentMode,
  useAgentRuntimeContext,
  useAgentSelection,
  useChatAgent,
} from './chat-experience/agent-provider';
import { AgentThreadRail } from './chat-experience/agent-thread-rail';
import { AgentTranscript } from './chat-experience/agent-transcript';

export interface ChatScreenProps {
  threadId?: string;
  /** Which chat runtime this screen drives. Defaults to staffing. */
  chatAgent?: ChatAgentMode;
}

export function ChatScreen({ threadId, chatAgent = 'staffing' }: ChatScreenProps) {
  const { selection, actions } = useAgentSelection();
  const { historyLoading } = useAgentRuntimeContext();
  const { chatAgent: activeAgent, setChatAgent } = useChatAgent();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Route owns the agent mode; sync it into the provider so the runtime body
  // and the branded UI follow the URL.
  useEffect(() => {
    if (chatAgent !== activeAgent) setChatAgent(chatAgent);
  }, [chatAgent, activeAgent, setChatAgent]);

  // Sync route param → provider selection. Provider is the source of truth;
  // /agent/chat keeps a search param for shareable links. The route's
  // `beforeLoad` guarantees the param, but guard anyway: syncing `undefined`
  // would re-mint a fresh id (provider invariant), re-trigger this effect, and
  // loop.
  useEffect(() => {
    if (threadId && threadId !== selection.threadId) actions.setThreadId(threadId);
  }, [threadId, selection.threadId, actions]);

  if (historyLoading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center text-caption text-ink-subtle">
        Loading chat…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="hidden lg:flex">
        <AgentThreadRail activeThreadId={selection.threadId} chatAgent={chatAgent} />
      </div>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          hideClose
          className="w-[280px] border-r border-hairline bg-surface-1 p-0 sm:max-w-none lg:hidden"
        >
          <AgentThreadRail
            activeThreadId={selection.threadId}
            chatAgent={chatAgent}
            onAfterNavigate={() => setMobileNavOpen(false)}
            className="w-full border-r-0 lg:w-full"
          />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <AgentHeader chatAgent={chatAgent} onOpenMobileNav={() => setMobileNavOpen(true)} />
        <AgentTranscript />
        <AgentComposer />
      </div>
    </div>
  );
}
