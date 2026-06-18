import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@seta/shared-ui';
import type { ReactNode } from 'react';

export function MetricHelpLabel({
  children,
  help,
  className,
}: {
  children: ReactNode;
  help: string;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex cursor-help items-center text-ink ${className ?? ''}`}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-48 whitespace-normal px-2 py-1 text-[10px] leading-tight">
          {help}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
