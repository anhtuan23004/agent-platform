import { Bell, Building2, ChevronDown, Search, Sparkles } from 'lucide-react';
import type * as React from 'react';
import { SetaMark } from '../icons/seta-mark';
import { cn } from '../lib/cn';
import { KbdHint } from './kbd-hint';

export interface TopBarProps {
  workspace: string;
  onWorkspaceClick?: () => void;
  userMenu?: React.ReactNode;
  onSearchOpen?: () => void;
  copilotOpen?: boolean;
  copilotAlert?: boolean;
  onCopilotToggle?: () => void;
  notificationCount?: number;
  className?: string;
}

export function TopBar({
  workspace,
  onWorkspaceClick,
  userMenu,
  onSearchOpen,
  copilotOpen = false,
  copilotAlert = false,
  onCopilotToggle,
  notificationCount = 0,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        'flex h-12 flex-none items-center justify-between border-b border-hairline bg-canvas px-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <SetaMark size={20} />
        <span className="text-body-sm font-semibold tracking-tight text-ink">Seta</span>
        <span className="h-[18px] w-px bg-hairline" />
        <button
          type="button"
          onClick={onWorkspaceClick}
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-caption text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <Building2 className="size-3.5" aria-hidden />
          <span className="text-ink">{workspace}</span>
          <ChevronDown className="size-3 text-ink-subtle" aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSearchOpen}
          className="inline-flex h-6 items-center gap-2 rounded-md px-2 text-caption text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          aria-label="Search or jump to"
        >
          <Search className="size-3.5" aria-hidden />
          <span className="text-ink-subtle">Search or jump to…</span>
          <KbdHint keys={['⌘K']} />
        </button>

        <button
          type="button"
          className="relative inline-flex size-6 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          aria-label={
            notificationCount > 0 ? `Notifications (${notificationCount})` : 'Notifications'
          }
          title="Notifications"
        >
          <Bell className="size-3.5" aria-hidden />
          {notificationCount > 0 && (
            <span
              className="absolute right-0.5 top-0.5 inline-block size-1.5 rounded-full bg-primary"
              aria-hidden
            />
          )}
        </button>

        <button
          type="button"
          onClick={onCopilotToggle}
          aria-pressed={copilotOpen}
          aria-label={copilotOpen ? 'Hide copilot panel' : 'Show copilot panel'}
          title={copilotOpen ? 'Hide copilot panel' : 'Show copilot panel'}
          className={cn(
            'relative inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-body-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
            copilotOpen
              ? 'border-primary-border bg-primary-tint text-primary-ink'
              : 'border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          <Sparkles
            className={cn('size-3.5', copilotOpen ? 'text-primary' : 'text-ink-muted')}
            aria-hidden
          />
          Copilot
          {copilotAlert && (
            <span
              className="absolute right-1.5 top-1 inline-block size-1.5 rounded-full bg-semantic-warning ring-2 ring-canvas"
              aria-hidden
            />
          )}
          <KbdHint keys={['⌘\\']} />
        </button>

        <span className="mx-1 h-[18px] w-px bg-hairline" />

        {userMenu}
      </div>
    </header>
  );
}
