import { Loader2, Sparkles } from 'lucide-react';
import type { PmoStepTransitionState } from './pmo-step-transition.logic.ts';

export interface PmoStepTransitionCardProps {
  transition: PmoStepTransitionState;
}

export function PmoStepTransitionCard({ transition }: PmoStepTransitionCardProps) {
  const { lastStepLabel, nextStepLabel } = transition;
  const heading = nextStepLabel ? `Preparing ${nextStepLabel}` : 'Completing ingestion';
  const body = nextStepLabel
    ? lastStepLabel
      ? `${lastStepLabel} is done. The agent is preparing the next review step.`
      : 'The agent is preparing the next review step.'
    : lastStepLabel
      ? `${lastStepLabel} is done. The agent is finishing the workflow.`
      : 'The agent is processing the workflow.';

  return (
    <div
      className="overflow-hidden rounded-xl border border-hairline bg-canvas shadow-sm"
      role="status"
      aria-live="polite"
      aria-label={heading}
    >
      <div className="flex items-center gap-2 border-b border-hairline bg-surface-1 px-4 py-2.5">
        <Sparkles className="size-4 text-brand" aria-hidden />
        <span className="text-body-sm font-semibold text-ink">{heading}</span>
        <span className="rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-medium uppercase text-info">
          processing
        </span>
        <Loader2 className="ml-auto size-4 animate-spin text-ink-subtle" aria-hidden />
      </div>
      <p className="px-4 py-3 text-body-sm text-ink-subtle">{body}</p>
    </div>
  );
}
