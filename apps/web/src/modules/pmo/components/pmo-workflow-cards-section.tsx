import { CheckCircle2, LockKeyhole } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PmoPlan, PmoPlanningSession } from '../api/client';
import type { ExecutionCard } from '../pages/pmo-page.logic';
import { statusTone, workflowStepTone } from '../pages/pmo-page.logic';
import {
  PmoExecutionStepCard,
  type PmoExecutionStepMappingProps,
  type PmoExecutionStepNormalizationProps,
  type PmoExecutionStepPlanProps,
  type PmoExecutionStepProfilingProps,
  type PmoExecutionStepPublishProps,
  type PmoExecutionStepReportProps,
  type PmoExecutionStepRuntimeProps,
} from './pmo-execution-step-card';

type WorkflowCardKind = 'execution';
type WorkflowCardAccess = 'history_view_only' | 'current_actionable' | 'future_locked';

interface WorkflowCardModel {
  id: string;
  ordinal: number;
  kind: WorkflowCardKind;
  label: string;
  statusLabel: string;
  access: WorkflowCardAccess;
  step?: ExecutionCard;
}

interface PmoWorkflowCardsSectionProps {
  selectedSession: PmoPlanningSession;
  plan: PmoPlan | null;
  goalDraft: string;
  executionCards: ExecutionCard[];
  selectedFeedback: string;
  onFeedbackChange: (nextValue: string) => void;
  isGenerating: boolean;
  isApproving: boolean;
  isConfirmingIntent: boolean;
  onConfirmIntent: (selection?: {
    dataSourceMode?: 'existing_db' | 'uploaded_file';
    actionMode?: NonNullable<PmoPlan['intent_analysis']>['actionMode'];
  }) => void;
  onRegeneratePlan: () => void;
  onApprovePlanAndStart: () => void;
  feedbackHistoryItems: Array<{ key: string; feedback: string }>;
  runtime: PmoExecutionStepRuntimeProps;
  mapping: PmoExecutionStepMappingProps;
  normalization: PmoExecutionStepNormalizationProps;
  publish: PmoExecutionStepPublishProps;
  report: PmoExecutionStepReportProps;
  profiling: PmoExecutionStepProfilingProps;
  planContext: PmoExecutionStepPlanProps;
}

function accessTone(access: WorkflowCardAccess): {
  card: string;
  marker: string;
  text: string;
  status: string;
} {
  if (access === 'history_view_only') {
    return {
      card: 'border-hairline bg-canvas text-ink',
      marker: 'border-success-border bg-success-tint text-success-ink',
      text: 'text-ink',
      status: 'text-success-ink',
    };
  }

  if (access === 'current_actionable') {
    return {
      card: 'border-primary bg-primary-tint/30 text-primary-ink',
      marker: 'border-primary bg-primary text-white',
      text: 'text-primary-ink',
      status: 'text-primary-ink',
    };
  }

  return {
    card: 'border-hairline bg-surface-2 text-ink-subtle opacity-75',
    marker: 'border-hairline-strong bg-canvas text-ink-muted',
    text: 'text-ink-subtle',
    status: 'text-ink-muted',
  };
}

function findCurrentExecutionIndex(cards: ExecutionCard[], runtime: PmoExecutionStepRuntimeProps) {
  if (cards.length === 0) return -1;

  const currentByNo =
    typeof runtime.executionCurrentStepNo === 'number'
      ? cards.findIndex((step) => step.step_no === runtime.executionCurrentStepNo)
      : -1;
  if (currentByNo >= 0) return currentByNo;

  const statusIndex = cards.findIndex(
    (step) =>
      step.status === 'in_progress' || step.status === 'needs_review' || step.status === 'failed',
  );
  if (statusIndex >= 0) return statusIndex;

  return cards.findIndex((step) => step.status === 'pending');
}

function buildWorkflowCards(params: {
  executionCards: ExecutionCard[];
  runtime: PmoExecutionStepRuntimeProps;
}): WorkflowCardModel[] {
  const { executionCards, runtime } = params;
  const cards: WorkflowCardModel[] = [];
  const currentIndex = findCurrentExecutionIndex(executionCards, runtime);

  for (const [index, step] of executionCards.entries()) {
    const access: WorkflowCardAccess =
      currentIndex >= 0
        ? index < currentIndex
          ? 'history_view_only'
          : index === currentIndex
            ? 'current_actionable'
            : 'future_locked'
        : step.status === 'completed'
          ? 'history_view_only'
          : 'future_locked';

    cards.push({
      id: `execution-${step.step_no}`,
      ordinal: index + 1,
      kind: 'execution',
      label: step.step_name,
      statusLabel: workflowStepTone(step.status).label,
      access,
      step,
    });
  }

  return cards;
}

export function IntentResolutionOptions(props: {
  options: NonNullable<NonNullable<PmoPlan['intent_analysis']>['resolution_options']>;
  isSubmitting: boolean;
  onConfirm: PmoWorkflowCardsSectionProps['onConfirmIntent'];
}) {
  const { options, isSubmitting, onConfirm } = props;

  return (
    <div className="space-y-3 rounded-md border border-warning-border bg-warning-tint/30 p-3">
      <p className="font-medium text-ink">Choose workflow scope</p>
      <div className="grid gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="rounded-md border border-hairline bg-surface-1 px-3 py-2 text-left transition-colors hover:border-primary hover:bg-primary-tint/20 disabled:opacity-60"
            onClick={() =>
              onConfirm({
                dataSourceMode: option.dataSourceMode,
                actionMode: option.actionMode,
              })
            }
            disabled={isSubmitting}
          >
            <span className="block font-medium text-ink">{option.label}</span>
            <span className="mt-0.5 block text-ink-subtle">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PmoWorkflowCardsSection(props: PmoWorkflowCardsSectionProps) {
  const {
    selectedSession,
    executionCards,
    runtime,
    mapping,
    normalization,
    publish,
    report,
    profiling,
    planContext,
  } = props;

  const cards = useMemo(
    () => buildWorkflowCards({ executionCards, runtime }),
    [executionCards, runtime],
  );
  const currentCard =
    cards.find((card) => card.access === 'current_actionable') ?? cards.at(-1) ?? null;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const selectedCard = cards.find(
    (card) => card.id === selectedCardId && card.access !== 'future_locked',
  );
  const activeCard = selectedCard ?? currentCard;

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-caption text-ink-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-body-sm font-semibold text-ink">Workflow cards</h3>
          <p className="mt-0.5">
            Execution steps for the current ingestion session. Future steps stay locked until the
            current step moves forward.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-caption font-medium ${statusTone(selectedSession.status_label)}`}
        >
          {selectedSession.status_label}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto pb-1">
        <ol className="flex min-w-max gap-2">
          {cards.map((card) => {
            const tone = accessTone(card.access);
            const isActive = activeCard?.id === card.id;
            const disabled = card.access === 'future_locked';

            return (
              <li key={card.id} className="w-[184px] shrink-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedCardId(card.id)}
                  className={`h-full w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${tone.card} ${
                    isActive ? 'ring-2 ring-primary/30' : ''
                  } ${disabled ? 'cursor-not-allowed' : 'hover:bg-surface-1'}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold ${tone.marker}`}
                    >
                      {card.access === 'history_view_only' ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : card.access === 'future_locked' ? (
                        <LockKeyhole className="size-3.5" />
                      ) : (
                        card.ordinal
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate font-medium ${tone.text}`}>
                        {card.ordinal}. {card.label}
                      </span>
                      <span className={`mt-0.5 block truncate ${tone.status}`}>
                        {card.statusLabel}
                      </span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-3 rounded-lg border border-hairline bg-canvas p-3">
        {activeCard?.kind === 'execution' && activeCard.step ? (
          <ol>
            <PmoExecutionStepCard
              selectedSession={selectedSession}
              step={activeCard.step}
              runtime={runtime}
              mapping={mapping}
              normalization={normalization}
              publish={publish}
              report={report}
              profiling={profiling}
              plan={planContext}
            />
          </ol>
        ) : null}
      </div>
    </section>
  );
}
