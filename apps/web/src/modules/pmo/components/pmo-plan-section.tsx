import { Button, Label, Textarea } from '@seta/shared-ui';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { PmoPlan, PmoPlanningSession, PmoWorkflowExecutionStepStatus } from '../api/client';
import type { TimelineState } from '../pages/pmo-page.logic';
import {
  executionStepMatchesRuntimeStep,
  formatLocalDate,
  proposedStepTone,
  statusTone,
  toneForState,
} from '../pages/pmo-page.logic';

interface PmoPlanSectionProps {
  selectedSession: PmoPlanningSession;
  plan: PmoPlan | null;
  goalDraft: string;
  timeline: Array<{ id: number; label: string; state: TimelineState }>;
  proposedWorkflowSteps: PmoPlan['proposed_workflow'];
  proposedStepStatusByNo: Map<number, PmoWorkflowExecutionStepStatus>;
  runtimeActiveStepId: string | null;
  selectedFeedback: string;
  onFeedbackChange: (nextValue: string) => void;
  isGenerating: boolean;
  isApproving: boolean;
  onRegeneratePlan: () => void;
  onApprovePlanAndStart: () => void;
  feedbackHistoryItems: Array<{ key: string; feedback: string }>;
}

export function PmoPlanSection(props: PmoPlanSectionProps) {
  const {
    selectedSession,
    plan,
    goalDraft,
    timeline,
    proposedWorkflowSteps,
    proposedStepStatusByNo,
    runtimeActiveStepId,
    selectedFeedback,
    onFeedbackChange,
    isGenerating,
    isApproving,
    onRegeneratePlan,
    onApprovePlanAndStart,
    feedbackHistoryItems,
  } = props;

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body-sm font-semibold text-ink">Plan</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-caption font-medium ${statusTone(selectedSession.status_label)}`}
        >
          {selectedSession.status_label}
        </span>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-caption text-ink-subtle">
          Version {Math.max(1, selectedSession.plan_version)}
        </span>
      </div>

      <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-ink">
            <span className="font-semibold">Interpreted goal:</span>{' '}
            {(plan?.goal_summary ?? selectedSession.goal) || goalDraft}
          </p>
          <p className="text-success-ink">
            <span className="font-semibold">Plan status:</span> {selectedSession.status_label}
          </p>
        </div>
        <p className="mt-1 text-ink-subtle">
          {plan?.title ?? 'Plan will appear here after Analyze & Generate Plan.'}
        </p>
      </div>

      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {timeline.map((step) => {
          const tone = toneForState(step.state);
          const stateLabel =
            step.state === 'done' ? 'Done' : step.state === 'current' ? 'In progress' : 'Pending';

          return (
            <li
              key={step.id}
              className="rounded-lg border border-hairline bg-canvas px-2.5 py-2 text-caption"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold ${tone.marker}`}
                >
                  {step.state === 'done' ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : step.state === 'pending' ? (
                    <Circle className="size-3.5" />
                  ) : (
                    step.id
                  )}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-ink">{step.label}</p>
                  <p className={`mt-0.5 ${tone.text}`}>{stateLabel}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {selectedSession.planning_state === 'generating_plan' ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
          <Loader2 className="size-4 animate-spin" />
          Generating plan from Goal and uploaded file metadata...
        </div>
      ) : null}

      {plan ? (
        <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption text-ink-subtle">
          <p className="font-medium text-ink">Proposed workflow</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            {plan.proposed_workflow.map((step) => (
              <li key={`${selectedSession.ingestion_session_id}-step-${step.step_no}`}>
                <span className="font-medium text-ink">{step.step_name}</span>: {step.description}
              </li>
            ))}
          </ol>
          <p className="mt-2">
            Last generated:{' '}
            <span className="text-ink">{formatLocalDate(selectedSession.plan_generated_at)}</span>
          </p>
        </div>
      ) : null}

      {selectedSession.planning_state !== 'approved_plan' && proposedWorkflowSteps.length > 0 ? (
        <section className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption text-ink-subtle">
          <p className="font-medium text-ink">Proposed workflow visual</p>
          <p className="mt-1">
            Steps are connected in order to make flow progression easier to scan.
          </p>

          <div className="mt-3 overflow-x-auto pb-1">
            <ol className="grid min-w-[520px] grid-cols-2 gap-x-2 gap-y-3 md:flex md:min-w-max md:items-start md:gap-0">
              {proposedWorkflowSteps.map((step, index) => {
                const isLast = index === proposedWorkflowSteps.length - 1;
                const runtimeFallbackStatus: PmoWorkflowExecutionStepStatus =
                  runtimeActiveStepId &&
                  executionStepMatchesRuntimeStep(
                    {
                      step_no: step.step_no,
                      step_name: step.step_name,
                      status: 'pending',
                    },
                    runtimeActiveStepId,
                  )
                    ? 'in_progress'
                    : 'pending';
                const stepStatus =
                  proposedStepStatusByNo.get(step.step_no) ??
                  (selectedSession.planning_state === 'approved_plan'
                    ? runtimeFallbackStatus
                    : 'pending');
                const tone = proposedStepTone(stepStatus);

                return (
                  <li
                    key={`${selectedSession.ingestion_session_id}-proposed-visual-step-${step.step_no}`}
                    className="flex items-start"
                  >
                    <div className="flex w-[140px] shrink-0 flex-col items-center">
                      <span
                        className={`flex size-9 items-center justify-center rounded-full border text-body-sm font-semibold ${tone.circle}`}
                      >
                        {step.step_no}
                      </span>
                      <p className={`mt-2 px-1 text-center text-caption font-medium ${tone.text}`}>
                        {step.step_name}
                      </p>
                    </div>
                    {!isLast ? (
                      <span
                        aria-hidden="true"
                        className={`mt-[18px] hidden h-0.5 w-10 shrink-0 md:block ${tone.line}`}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
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
            disabled={selectedSession.planning_state !== 'plan_review' || isApproving}
          >
            {isApproving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Approving...
              </>
            ) : (
              'Approve plan'
            )}
          </Button>
        </div>
      </div>

      {feedbackHistoryItems.length > 0 ? (
        <div className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-caption">
          <p className="font-medium text-ink">Feedback history</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-ink-subtle">
            {feedbackHistoryItems.map((item) => (
              <li key={item.key}>{item.feedback}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
