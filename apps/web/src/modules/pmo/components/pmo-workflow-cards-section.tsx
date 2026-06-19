import { Button, Input, Label, Textarea } from '@seta/shared-ui';
import { CheckCircle2, Loader2, LockKeyhole } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PmoPlan, PmoPlanningSession } from '../api/client';
import type { ExecutionCard } from '../pages/pmo-page.logic';
import { formatLocalDate, statusTone, workflowStepTone } from '../pages/pmo-page.logic';
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

type WorkflowCardKind = 'intent' | 'plan' | 'execution';
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
    dateRangeStrategy?: 'sheet_derived' | 'manual_database';
    dateRange?: { from: string; to: string };
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

function intentModeLabel(mode: string | undefined): string {
  if (mode === 'review_only') return 'Review only';
  if (mode === 'mapping_readiness') return 'Mapping readiness';
  if (mode === 'stage_preview') return 'Stage preview';
  if (mode === 'publish_intent') return 'Publish intent';
  if (mode === 'generate_report_intent') return 'Database report';
  if (mode === 'publish_report_intent') return 'Ingest and report';
  return 'Intent';
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
  session: PmoPlanningSession;
  plan: PmoPlan | null;
  executionCards: ExecutionCard[];
  runtime: PmoExecutionStepRuntimeProps;
}): WorkflowCardModel[] {
  const { session, plan, executionCards, runtime } = params;
  const intent = session.intent ?? plan?.intent_analysis;
  const intentRequiresConfirmation = intent?.requires_confirmation === true;
  const hasIntent = Boolean(intent);
  const hasPlan = Boolean(plan);
  const planApproved = session.planning_state === 'approved_plan';
  const cards: WorkflowCardModel[] = [
    {
      id: 'intent',
      ordinal: 1,
      kind: 'intent',
      label: 'Intent',
      statusLabel: !hasIntent
        ? 'Pending'
        : intentRequiresConfirmation
          ? 'Needs confirmation'
          : 'Confirmed',
      access: !hasIntent || intentRequiresConfirmation ? 'current_actionable' : 'history_view_only',
    },
  ];

  if (hasPlan) {
    cards.push({
      id: 'plan',
      ordinal: 2,
      kind: 'plan',
      label: 'Plan',
      statusLabel: planApproved ? 'Approved' : 'In review',
      access:
        intentRequiresConfirmation || !hasPlan
          ? 'future_locked'
          : planApproved
            ? 'history_view_only'
            : 'current_actionable',
    });
  }

  if (planApproved) {
    const currentIndex = findCurrentExecutionIndex(executionCards, runtime);
    for (const [index, step] of executionCards.entries()) {
      const access =
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
        ordinal: index + 3,
        kind: 'execution',
        label: step.step_name,
        statusLabel: workflowStepTone(step.status).label,
        access,
        step,
      });
    }
  }

  return cards;
}

export function IntentReportDateRangeForm(props: {
  request: NonNullable<NonNullable<PmoPlan['intent_analysis']>['report_request']>;
  isSubmitting: boolean;
  onConfirm: PmoWorkflowCardsSectionProps['onConfirmIntent'];
}) {
  const { request, isSubmitting, onConfirm } = props;
  const bounds = request.database_date_bounds;
  const [from, setFrom] = useState(bounds?.min ?? '');
  const [to, setTo] = useState(bounds?.max ?? '');
  const canUseDatabaseRange = Boolean(
    from && to && from <= to && (!bounds || (from >= bounds.min && to <= bounds.max)),
  );

  return (
    <div className="space-y-3 rounded-md border border-warning-border bg-warning-tint/30 p-3">
      <p className="font-medium text-ink">Choose report date range</p>
      {bounds ? (
        <p className="text-ink-subtle">
          Database range: {bounds.min} to {bounds.max}
        </p>
      ) : null}
      {request.date_range_strategy === 'sheet_or_database_confirmation' ? (
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => onConfirm({ dateRangeStrategy: 'sheet_derived' })}
          disabled={isSubmitting}
        >
          Use dates from sheet
        </Button>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="intent-report-from">From</Label>
          <Input
            id="intent-report-from"
            type="date"
            min={bounds?.min}
            max={bounds?.max}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="intent-report-to">To</Label>
          <Input
            id="intent-report-to"
            type="date"
            min={bounds?.min}
            max={bounds?.max}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="primary"
        onClick={() =>
          onConfirm({
            dateRangeStrategy: 'manual_database',
            dateRange: { from, to },
          })
        }
        disabled={!canUseDatabaseRange || isSubmitting}
      >
        {isSubmitting ? 'Confirming...' : 'Use database range'}
      </Button>
    </div>
  );
}

export function PmoWorkflowCardsSection(props: PmoWorkflowCardsSectionProps) {
  const {
    selectedSession,
    plan,
    goalDraft,
    executionCards,
    selectedFeedback,
    onFeedbackChange,
    isGenerating,
    isApproving,
    isConfirmingIntent,
    onConfirmIntent,
    onRegeneratePlan,
    onApprovePlanAndStart,
    feedbackHistoryItems,
    runtime,
    mapping,
    normalization,
    publish,
    report,
    profiling,
    planContext,
  } = props;

  const cards = useMemo(
    () => buildWorkflowCards({ session: selectedSession, plan, executionCards, runtime }),
    [executionCards, plan, runtime, selectedSession],
  );
  const currentCard =
    cards.find((card) => card.access === 'current_actionable') ?? cards[0] ?? null;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const selectedCard = cards.find(
    (card) => card.id === selectedCardId && card.access !== 'future_locked',
  );
  const activeCard = selectedCard ?? currentCard;
  const intent = selectedSession.intent ?? plan?.intent_analysis;
  const reportRequestNeedsDate =
    intent?.report_request?.date_range_strategy === 'database_confirmation' ||
    intent?.report_request?.date_range_strategy === 'sheet_or_database_confirmation';
  const canApprovePlan =
    selectedSession.planning_state === 'plan_review' && intent?.requires_confirmation !== true;

  const goToNextAccessibleCard = () => {
    if (!activeCard) return;
    const activeIndex = cards.findIndex((card) => card.id === activeCard.id);
    const next = cards.slice(activeIndex + 1).find((card) => card.access !== 'future_locked');
    if (next) {
      setSelectedCardId(next.id);
    }
  };

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-caption text-ink-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-body-sm font-semibold text-ink">Workflow cards</h3>
          <p className="mt-0.5">
            Intent, plan, and execution steps share one workflow path. Future steps stay locked
            until the current step moves forward.
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
        {activeCard?.kind === 'intent' ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-body-sm font-semibold text-ink">Intent review</h4>
              {intent ? (
                <>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-ink">
                    {intentModeLabel(intent.intent_mode)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      intent.confidence === 'low'
                        ? 'bg-warning-tint text-warning-ink'
                        : 'bg-success-tint text-success-ink'
                    }`}
                  >
                    {intent.confidence} confidence
                  </span>
                </>
              ) : null}
            </div>

            {intent ? (
              <>
                <p className="text-ink-subtle">{intent.rationale}</p>
                <div className="rounded-md border border-hairline bg-surface-1 px-3 py-2">
                  <p className="font-medium text-ink">Allowed workflow scope</p>
                  <p className="mt-1 text-ink-subtle">{intent.allowed_action_ids.join(', ')}</p>
                </div>
                {intent.requires_confirmation ? (
                  <div className="rounded-md border border-warning-border bg-warning-tint/70 px-3 py-2 text-warning-ink">
                    {reportRequestNeedsDate
                      ? 'Complete report date selection to generate the plan.'
                      : 'Intent confidence is low. Confirm scope to generate the plan.'}
                  </div>
                ) : null}
                {reportRequestNeedsDate && intent.report_request ? (
                  <IntentReportDateRangeForm
                    request={intent.report_request}
                    isSubmitting={isConfirmingIntent}
                    onConfirm={onConfirmIntent}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-ink-subtle">
                Generate a plan to classify intent from the goal and workbook metadata.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {intent?.requires_confirmation && !reportRequestNeedsDate ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => onConfirmIntent()}
                  disabled={isConfirmingIntent}
                >
                  {isConfirmingIntent ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    'Next step'
                  )}
                </Button>
              ) : plan ? (
                <Button type="button" size="sm" variant="primary" onClick={goToNextAccessibleCard}>
                  Next step
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeCard?.kind === 'plan' ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-body-sm font-semibold text-ink">Plan review</h4>
              <span className="rounded-full bg-canvas px-2 py-0.5 text-caption text-ink-subtle">
                Version {Math.max(1, selectedSession.plan_version)}
              </span>
            </div>

            <div className="rounded-md border border-hairline bg-surface-1 px-3 py-2">
              <p className="text-ink">
                <span className="font-semibold">Interpreted goal:</span>{' '}
                {(plan?.goal_summary ?? selectedSession.goal) || goalDraft}
              </p>
              <p className="mt-1 text-ink-subtle">
                {plan?.title ?? 'Plan will appear after Analyze & Generate Plan.'}
              </p>
            </div>

            {plan ? (
              <div className="rounded-md border border-hairline bg-surface-1 px-3 py-2">
                <p className="font-medium text-ink">Compiled workflow</p>
                <ol className="mt-1 list-decimal space-y-1 pl-4">
                  {plan.proposed_workflow.map((step) => (
                    <li key={`${selectedSession.ingestion_session_id}-step-${step.step_no}`}>
                      <span className="font-medium text-ink">{step.step_name}</span>:{' '}
                      {step.description}
                    </li>
                  ))}
                </ol>
                <p className="mt-2">
                  Last generated:{' '}
                  <span className="text-ink">
                    {formatLocalDate(selectedSession.plan_generated_at)}
                  </span>
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="space-y-2">
                <Label htmlFor="plan-feedback">Plan feedback</Label>
                <Textarea
                  id="plan-feedback"
                  rows={2}
                  value={selectedFeedback}
                  onChange={(event) => onFeedbackChange(event.target.value)}
                  placeholder="Example: Keep only validation and do not continue to DB write yet."
                  disabled={isGenerating || selectedSession.planning_state === 'approved_plan'}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onRegeneratePlan}
                  disabled={selectedSession.planning_state !== 'plan_review' || isGenerating}
                >
                  Regenerate plan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={onApprovePlanAndStart}
                  disabled={!canApprovePlan || isApproving}
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    'Next step'
                  )}
                </Button>
              </div>
            </div>

            {feedbackHistoryItems.length > 0 ? (
              <div className="rounded-md border border-hairline bg-surface-1 px-3 py-2">
                <p className="font-medium text-ink">Feedback history</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-ink-subtle">
                  {feedbackHistoryItems.map((item) => (
                    <li key={item.key}>{item.feedback}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

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
