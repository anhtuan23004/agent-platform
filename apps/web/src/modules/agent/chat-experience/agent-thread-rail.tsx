import { ChatThreadRail } from '@seta/shared-ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useThreadList } from '../hooks/use-thread-list';
import type { ChatAgentMode } from './agent-provider';
import { useAgentSelection } from './agent-provider';

interface AgentThreadRailProps {
  activeThreadId?: string;
  chatAgent?: ChatAgentMode;
  onAfterNavigate?: () => void;
  className?: string;
}

export function AgentThreadRail({
  activeThreadId,
  chatAgent = 'staffing',
  onAfterNavigate,
  className,
}: AgentThreadRailProps) {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const { groups } = useThreadList(chatAgent);
  const { actions } = useAgentSelection();
  const chatPath = chatAgent === 'pmo' ? '/pmo/agent' : '/agent/chat';

  return (
    <ChatThreadRail
      groups={groups ?? []}
      activeId={activeThreadId}
      onSelect={(id) => {
        void navigate({ to: chatPath, search: { thread: id } });
        onAfterNavigate?.();
      }}
      onNewThread={() => {
        const id = actions.startFreshThread();
        void navigate({ to: chatPath, search: { thread: id }, replace: true });
        onAfterNavigate?.();
      }}
      searchValue={search}
      onSearchChange={setSearch}
      className={className}
    />
  );
}
