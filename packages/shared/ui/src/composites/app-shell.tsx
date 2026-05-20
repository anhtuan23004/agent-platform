import * as React from 'react';

import { cn } from '../lib/cn';
import { CopilotPanel } from './copilot-panel';
import { LeftNav, type ShellLinkComponent, type ShellNavModule } from './left-nav';
import { TopBar } from './top-bar';

export interface AppShellProps {
  workspace: string;
  onWorkspaceClick?: () => void;
  userMenu?: React.ReactNode;
  onSearchOpen?: () => void;

  modules: ShellNavModule[];
  activeItemId?: string;
  linkComponent?: ShellLinkComponent;
  sessionFooter?: React.ReactNode;
  defaultSidebarCollapsed?: boolean;

  copilotPanel?: React.ReactNode;
  copilotAlert?: boolean;
  defaultCopilotOpen?: boolean;
  notificationCount?: number;

  children: React.ReactNode;
  className?: string;
}

export function AppShell({
  workspace,
  onWorkspaceClick,
  userMenu,
  onSearchOpen,
  modules,
  activeItemId,
  linkComponent,
  sessionFooter,
  defaultSidebarCollapsed = false,
  copilotPanel,
  copilotAlert = false,
  defaultCopilotOpen = false,
  notificationCount = 0,
  children,
  className,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(defaultSidebarCollapsed);
  const [copilotOpen, setCopilotOpen] = React.useState(defaultCopilotOpen);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === '\\') {
        e.preventDefault();
        setCopilotOpen((o) => !o);
      } else if (e.key === 'b' || e.key === 'B') {
        if (e.shiftKey) return;
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={cn(
        'flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink',
        className,
      )}
    >
      <TopBar
        workspace={workspace}
        onWorkspaceClick={onWorkspaceClick}
        userMenu={userMenu}
        onSearchOpen={onSearchOpen}
        copilotOpen={copilotOpen}
        copilotAlert={copilotAlert}
        onCopilotToggle={() => setCopilotOpen((o) => !o)}
        notificationCount={notificationCount}
      />
      <div className="flex min-h-0 flex-1">
        <LeftNav
          modules={modules}
          activeItemId={activeItemId}
          linkComponent={linkComponent}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          sessionFooter={sessionFooter}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-canvas">
          {children}
        </main>
        {copilotOpen && (
          <CopilotPanel onClose={() => setCopilotOpen(false)}>{copilotPanel}</CopilotPanel>
        )}
      </div>
    </div>
  );
}
