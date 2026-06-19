import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@seta/shared-ui';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useThreadList } from '../hooks/use-thread-list';
import { type ChatAgentMode, useAgentSelection } from './agent-provider';

interface AgentThreadSwitcherProps {
  chatAgent?: ChatAgentMode;
  onAfterSelect?: () => void;
}

export function AgentThreadSwitcher({
  chatAgent = 'staffing',
  onAfterSelect,
}: AgentThreadSwitcherProps) {
  const { groups } = useThreadList(chatAgent);
  const { actions, selection } = useAgentSelection();
  const navigate = useNavigate();
  const chatPath = chatAgent === 'pmo' ? '/pmo/agent' : '/agent/chat';

  const flat = (groups ?? [])
    .flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
    .slice(0, 8);

  return (
    <>
      <DropdownMenuItem
        onSelect={() => {
          const id = actions.startFreshThread();
          void navigate({ to: chatPath, search: { thread: id }, replace: true });
          onAfterSelect?.();
        }}
        className="gap-2"
      >
        <Plus className="size-3.5" aria-hidden />
        New chat
      </DropdownMenuItem>
      {flat.length > 0 && <DropdownMenuSeparator />}
      {flat.length > 0 && (
        <DropdownMenuLabel className="text-caption uppercase tracking-wide text-ink-subtle">
          Recent
        </DropdownMenuLabel>
      )}
      {flat.map((t) => (
        <DropdownMenuItem
          key={t.id}
          onSelect={() => {
            actions.setThreadId(t.id);
            void navigate({ to: chatPath, search: { thread: t.id } });
            onAfterSelect?.();
          }}
          className={`gap-2 ${selection.threadId === t.id ? 'bg-surface-2' : ''}`}
        >
          <span className="truncate">{t.title || 'Untitled chat'}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          void navigate({ to: chatPath, search: { thread: selection.threadId } });
          onAfterSelect?.();
        }}
        className="gap-2 text-ink-muted"
      >
        {chatAgent === 'pmo' ? 'Show all in PMO Agent' : 'Show all in /agent/chat'}
      </DropdownMenuItem>
    </>
  );
}
