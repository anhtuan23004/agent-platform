import { Sheet, SheetContent } from '@seta/shared-ui';
import { useEffect, useState } from 'react';
import { AgentComposer } from './chat-experience/agent-composer';
import { AgentHeader } from './chat-experience/agent-header';
import {
  AgentRuntimeBoundary,
  type ChatAgentMode,
  useAgentRuntimeContext,
  useAgentSelection,
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sync route param → provider selection. Provider is the source of truth;
  // /agent/chat keeps a search param for shareable links. The route's
  // `beforeLoad` guarantees the param, but guard anyway: syncing `undefined`
  // would re-mint a fresh id (provider invariant), re-trigger this effect, and
  // loop.
  useEffect(() => {
    if (threadId && threadId !== selection.threadId) actions.setThreadId(threadId);
  }, [threadId, selection.threadId, actions]);

  return (
    <AgentRuntimeBoundary>
      <ChatScreenInner
        chatAgent={chatAgent}
        mobileNavOpen={mobileNavOpen}
        onMobileNavOpenChange={setMobileNavOpen}
      />
    </AgentRuntimeBoundary>
  );
}

function ChatScreenInner({
  chatAgent,
  mobileNavOpen,
  onMobileNavOpenChange,
}: {
  chatAgent: ChatAgentMode;
  mobileNavOpen: boolean;
  onMobileNavOpenChange: (next: boolean) => void;
}) {
  const { selection } = useAgentSelection();
  const { historyLoading } = useAgentRuntimeContext();

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
      <Sheet open={mobileNavOpen} onOpenChange={onMobileNavOpenChange}>
        <SheetContent
          side="left"
          hideClose
          className="w-[280px] border-r border-hairline bg-surface-1 p-0 sm:max-w-none lg:hidden"
        >
          <AgentThreadRail
            activeThreadId={selection.threadId}
            chatAgent={chatAgent}
            onAfterNavigate={() => onMobileNavOpenChange(false)}
            className="w-full border-r-0 lg:w-full"
          />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <AgentHeader chatAgent={chatAgent} onOpenMobileNav={() => onMobileNavOpenChange(true)} />
        <AgentTranscript />
        <AgentComposer />
      </div>
    </div>
  );
}
