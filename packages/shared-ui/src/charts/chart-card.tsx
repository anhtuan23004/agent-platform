import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ChartCardProps {
  title: string;
  /** Muted descriptor under the title. */
  subtitle?: ReactNode;
  /** Optional element rendered on the right of the header (e.g. a control). */
  action?: ReactNode;
  /** Forwarded to the card root for testing. */
  testId?: string;
  className?: string;
  children: ReactNode;
}

/** Generic carded container for a single chart. Reusable across any chart. */
export function ChartCard({
  title,
  subtitle,
  action,
  testId,
  className,
  children,
}: ChartCardProps) {
  return (
    <section
      data-testid={testId}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-lg border border-hairline bg-canvas p-5 shadow-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-body font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-body-sm text-ink-subtle">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
