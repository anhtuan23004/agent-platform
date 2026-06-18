import type { PmoPlanningSession } from '../api/client';
import type { ExecutionActionGroup } from '../pages/pmo-page.logic';
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

interface PmoWorkflowExecutionSectionProps {
  selectedSession: PmoPlanningSession;
  executionActionGroups: ExecutionActionGroup[];
  runtime: PmoExecutionStepRuntimeProps;
  mapping: PmoExecutionStepMappingProps;
  normalization: PmoExecutionStepNormalizationProps;
  publish: PmoExecutionStepPublishProps;
  report: PmoExecutionStepReportProps;
  profiling: PmoExecutionStepProfilingProps;
  plan: PmoExecutionStepPlanProps;
}

export function PmoWorkflowExecutionSection(props: PmoWorkflowExecutionSectionProps) {
  const {
    selectedSession,
    executionActionGroups,
    runtime,
    mapping,
    normalization,
    publish,
    report,
    profiling,
    plan,
  } = props;

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-caption text-ink-subtle">
      <p className="font-medium text-ink">Workflow execution</p>
      <p className="mt-1">
        Step cards are separated from plan details, grouped by action, and listed one row per card.
      </p>

      <div className="mt-3 space-y-3">
        {executionActionGroups.map((group) => (
          <section
            key={`${selectedSession.ingestion_session_id}-execution-group-${group.id}`}
            className="rounded-lg border border-hairline bg-canvas px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-ink">{group.title}</p>
                <p className="text-ink-subtle">{group.hint}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-caption font-medium ${group.badgeTone}`}
              >
                {group.steps.length} step{group.steps.length === 1 ? '' : 's'}
              </span>
            </div>

            <ol className="mt-2 space-y-2">
              {group.steps.map((step) => (
                <PmoExecutionStepCard
                  key={`${selectedSession.ingestion_session_id}-workflow-step-${step.step_no}`}
                  selectedSession={selectedSession}
                  step={step}
                  runtime={runtime}
                  mapping={mapping}
                  normalization={normalization}
                  publish={publish}
                  report={report}
                  profiling={profiling}
                  plan={plan}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
