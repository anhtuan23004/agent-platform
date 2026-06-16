import {
  findPlannerStepForRuntime,
  type PmoPlanActionId,
  RUNTIME_STEP_ACTION_PREFERENCES,
  readPlannerWorkflowSteps,
} from '../../planning/step-metadata.ts';
import type {
  WorkflowExecutionState,
  WorkflowExecutionStep,
  WorkflowExecutionStepStatus,
} from '../../profiling/workbook-profiling.ts';

export type RuntimeWorkflowStepId =
  | 'pmo.ingest.detect'
  | 'pmo.ingest.confirmMapping'
  | 'pmo.ingest.normalizeToStaging'
  | 'pmo.ingest.reviewChanges';

export type RuntimeWorkflowTransition = 'in_progress' | 'needs_review' | 'completed' | 'failed';

interface PlannerWorkflowStep {
  step_no: number;
  planner_step_id: string;
  action_id: PmoPlanActionId;
  review_type: string;
  step_name: string;
}

interface UpsertRuntimeExecutionStateParams {
  existingState: unknown;
  planningPlan: unknown;
  runtimeStepId: RuntimeWorkflowStepId;
  transition: RuntimeWorkflowTransition;
  nowIso: string;
}

const RUNTIME_STEP_LABEL: Record<RuntimeWorkflowStepId, string> = {
  'pmo.ingest.detect': 'Schema detection and mapping',
  'pmo.ingest.confirmMapping': 'Confirm mapping',
  'pmo.ingest.normalizeToStaging': 'Normalize to staging',
  'pmo.ingest.reviewChanges': 'Review changes and publish',
};

const RUNTIME_STEP_FALLBACK_ORDER: Record<RuntimeWorkflowStepId, number> = {
  'pmo.ingest.detect': 0,
  'pmo.ingest.confirmMapping': 1,
  'pmo.ingest.normalizeToStaging': 2,
  'pmo.ingest.reviewChanges': 3,
};

const RUNTIME_STEP_PATTERNS: Record<RuntimeWorkflowStepId, RegExp[]> = {
  'pmo.ingest.detect': [/detect/, /schema/, /profil/, /analysis/, /mapping/],
  'pmo.ingest.confirmMapping': [/confirm/, /mapping/, /reconcile/],
  'pmo.ingest.normalizeToStaging': [
    /normalize/,
    /staging/,
    /clean/,
    /transform/,
    /validate/,
    /validation/,
    /data\s*quality/,
    /duplicate/,
    /anomal/,
  ],
  'pmo.ingest.reviewChanges': [/review/, /publish/, /impact/, /approve/],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneStep(step: WorkflowExecutionStep): WorkflowExecutionStep {
  return {
    step_no: step.step_no,
    planner_step_id: step.planner_step_id,
    action_id: step.action_id,
    review_type: step.review_type,
    step_name: step.step_name,
    status: step.status,
  };
}

function sortSteps(steps: WorkflowExecutionStep[]): WorkflowExecutionStep[] {
  return [...steps].sort((a, b) => a.step_no - b.step_no);
}

function isTerminalStatus(status: WorkflowExecutionStepStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function readPlannerWorkflow(plan: unknown): PlannerWorkflowStep[] {
  return readPlannerWorkflowSteps(plan).map((step) => ({
    step_no: step.step_no,
    planner_step_id: step.planner_step_id,
    action_id: step.action_id,
    review_type: step.review_type,
    step_name: step.step_name,
  }));
}

function buildInitialStepsFromPlan(planningPlan: unknown): WorkflowExecutionStep[] {
  const plannerSteps = readPlannerWorkflow(planningPlan);
  if (plannerSteps.length > 0) {
    return plannerSteps.map((step, index) => ({
      step_no: step.step_no,
      planner_step_id: step.planner_step_id,
      action_id: step.action_id,
      review_type: step.review_type,
      step_name: step.step_name,
      status: index === 0 ? 'in_progress' : 'pending',
    }));
  }

  return [
    {
      step_no: 1,
      planner_step_id: 'pmo.planner.step.1.workbook_profiling',
      action_id: 'workbook_profiling',
      review_type: 'profiling',
      step_name: RUNTIME_STEP_LABEL['pmo.ingest.detect'],
      status: 'in_progress',
    },
    {
      step_no: 2,
      planner_step_id: 'pmo.planner.step.2.column_mapping',
      action_id: 'column_mapping',
      review_type: 'mapping',
      step_name: RUNTIME_STEP_LABEL['pmo.ingest.confirmMapping'],
      status: 'pending',
    },
    {
      step_no: 3,
      planner_step_id: 'pmo.planner.step.3.normalize_to_staging',
      action_id: 'normalize_to_staging',
      review_type: 'normalization',
      step_name: RUNTIME_STEP_LABEL['pmo.ingest.normalizeToStaging'],
      status: 'pending',
    },
    {
      step_no: 4,
      planner_step_id: 'pmo.planner.step.4.publish_after_approval',
      action_id: 'publish_after_approval',
      review_type: 'publish',
      step_name: RUNTIME_STEP_LABEL['pmo.ingest.reviewChanges'],
      status: 'pending',
    },
  ];
}

function createInitialState(planningPlan: unknown, nowIso: string): WorkflowExecutionState {
  const steps = sortSteps(buildInitialStepsFromPlan(planningPlan));
  const firstStepNo = steps[0]?.step_no ?? 1;

  return {
    state_version: 1,
    started_at: nowIso,
    updated_at: nowIso,
    current_step_no: firstStepNo,
    current_step_status: 'in_progress',
    steps,
    documents: [],
    profiling_summary: null,
    profiling_review: null,
  };
}

export function readWorkflowExecutionState(raw: unknown): WorkflowExecutionState | null {
  if (!isObject(raw)) return null;

  const stepsRaw = raw.steps;
  if (!Array.isArray(stepsRaw)) return null;

  const steps = stepsRaw
    .map((step): WorkflowExecutionStep | null => {
      if (!isObject(step)) return null;

      const stepNo = step.step_no;
      const stepName = step.step_name;
      const status = step.status;

      if (typeof stepNo !== 'number' || !Number.isFinite(stepNo)) return null;
      if (typeof stepName !== 'string' || stepName.trim().length === 0) return null;
      if (
        status !== 'pending' &&
        status !== 'in_progress' &&
        status !== 'completed' &&
        status !== 'needs_review' &&
        status !== 'failed' &&
        status !== 'cancelled'
      ) {
        return null;
      }

      return {
        step_no: Math.trunc(stepNo),
        planner_step_id:
          typeof step.planner_step_id === 'string' ? step.planner_step_id : undefined,
        action_id: typeof step.action_id === 'string' ? step.action_id : undefined,
        review_type: typeof step.review_type === 'string' ? step.review_type : undefined,
        step_name: stepName,
        status,
      };
    })
    .filter((step): step is WorkflowExecutionStep => Boolean(step));

  if (steps.length === 0) return null;

  const startedAt = typeof raw.started_at === 'string' ? raw.started_at : new Date().toISOString();
  const updatedAt = typeof raw.updated_at === 'string' ? raw.updated_at : startedAt;
  const firstStepNo = sortSteps(steps)[0]?.step_no ?? 1;
  const currentStepNo =
    typeof raw.current_step_no === 'number' && Number.isFinite(raw.current_step_no)
      ? Math.trunc(raw.current_step_no)
      : firstStepNo;

  const currentStepStatus =
    raw.current_step_status === 'in_progress' ||
    raw.current_step_status === 'needs_review' ||
    raw.current_step_status === 'completed' ||
    raw.current_step_status === 'failed' ||
    raw.current_step_status === 'cancelled'
      ? raw.current_step_status
      : 'in_progress';

  return {
    state_version: 1,
    started_at: startedAt,
    updated_at: updatedAt,
    current_step_no: currentStepNo,
    current_step_status: currentStepStatus,
    steps: sortSteps(steps).map(cloneStep),
    documents: Array.isArray(raw.documents)
      ? (raw.documents as WorkflowExecutionState['documents'])
      : [],
    profiling_summary:
      (raw.profiling_summary as WorkflowExecutionState['profiling_summary']) ?? null,
    profiling_review: (raw.profiling_review as WorkflowExecutionState['profiling_review']) ?? null,
  };
}

function resolveTargetStep(
  steps: WorkflowExecutionStep[],
  runtimeStepId: RuntimeWorkflowStepId,
  currentStepNo: number,
): {
  stepNo: number;
  stepName: string;
  plannerStepId?: string;
  actionId?: string;
  reviewType?: string;
} {
  const sorted = sortSteps(steps);
  const preferredActions = RUNTIME_STEP_ACTION_PREFERENCES[runtimeStepId];
  const matchByAction = preferredActions
    .map((actionId) => sorted.find((step) => step.action_id === actionId))
    .find((step): step is WorkflowExecutionStep => Boolean(step));

  const patterns = RUNTIME_STEP_PATTERNS[runtimeStepId];

  const matchByName = sorted.find((step) => {
    const normalized = step.step_name.toLowerCase();
    return patterns.some((pattern) => pattern.test(normalized));
  });

  const actionFallback = findPlannerStepForRuntime({ proposed_workflow: sorted }, runtimeStepId);
  const fallback = sorted[RUNTIME_STEP_FALLBACK_ORDER[runtimeStepId]];
  const baseTarget = matchByAction ??
    matchByName ??
    actionFallback ??
    fallback ?? {
      step_no: (sorted[sorted.length - 1]?.step_no ?? 0) + 1,
      planner_step_id: undefined,
      action_id: preferredActions[0],
      review_type: undefined,
      step_name: RUNTIME_STEP_LABEL[runtimeStepId],
      status: 'pending' as const,
    };

  if (baseTarget.step_no >= currentStepNo) {
    return {
      stepNo: baseTarget.step_no,
      stepName: baseTarget.step_name,
      plannerStepId: baseTarget.planner_step_id,
      actionId: baseTarget.action_id,
      reviewType: baseTarget.review_type,
    };
  }

  const current = sorted.find((step) => step.step_no === currentStepNo);
  if (current) {
    return {
      stepNo: current.step_no,
      stepName: current.step_name,
      plannerStepId: current.planner_step_id,
      actionId: current.action_id,
      reviewType: current.review_type,
    };
  }

  const firstAhead = sorted.find((step) => step.step_no > currentStepNo);
  if (firstAhead) {
    return {
      stepNo: firstAhead.step_no,
      stepName: firstAhead.step_name,
      plannerStepId: firstAhead.planner_step_id,
      actionId: firstAhead.action_id,
      reviewType: firstAhead.review_type,
    };
  }

  return {
    stepNo: currentStepNo,
    stepName: RUNTIME_STEP_LABEL[runtimeStepId],
    actionId: preferredActions[0],
  };
}

function currentStatusFromStep(
  step: WorkflowExecutionStep | undefined,
): WorkflowExecutionState['current_step_status'] | null {
  if (!step) return null;
  if (step.status === 'in_progress') return 'in_progress';
  if (step.status === 'needs_review') return 'needs_review';
  if (step.status === 'failed') return 'failed';
  if (step.status === 'cancelled') return 'cancelled';
  if (step.status === 'completed') return 'completed';
  return null;
}

function applyTransition(
  state: WorkflowExecutionState,
  runtimeStepId: RuntimeWorkflowStepId,
  transition: RuntimeWorkflowTransition,
  nowIso: string,
): WorkflowExecutionState {
  if (state.current_step_status === 'cancelled') {
    return {
      ...state,
      updated_at: nowIso,
    };
  }

  const nextSteps = sortSteps(state.steps).map(cloneStep);
  const target = resolveTargetStep(nextSteps, runtimeStepId, state.current_step_no);

  if (!nextSteps.some((step) => step.step_no === target.stepNo)) {
    nextSteps.push({
      step_no: target.stepNo,
      planner_step_id: target.plannerStepId,
      action_id: target.actionId,
      review_type: target.reviewType,
      step_name: target.stepName,
      status: 'pending',
    });
  }

  const ordered = sortSteps(nextSteps).map((step) => {
    if (step.step_no < target.stepNo && !isTerminalStatus(step.status)) {
      return {
        ...step,
        status: 'completed' as const,
      };
    }

    if (step.step_no === target.stepNo) {
      return {
        ...step,
        status: transition,
      };
    }

    if (step.status === 'in_progress') {
      return {
        ...step,
        status: 'pending' as const,
      };
    }

    return step;
  });

  if (transition !== 'completed') {
    return {
      ...state,
      updated_at: nowIso,
      current_step_no: target.stepNo,
      current_step_status: transition,
      steps: ordered,
    };
  }

  const nextCandidate = ordered.find(
    (step) =>
      step.step_no > target.stepNo &&
      step.status !== 'completed' &&
      step.status !== 'failed' &&
      step.status !== 'cancelled',
  );

  if (!nextCandidate) {
    return {
      ...state,
      updated_at: nowIso,
      current_step_no: target.stepNo,
      current_step_status: 'completed',
      steps: ordered,
    };
  }

  const promotedSteps = ordered.map((step) => {
    if (step.step_no !== nextCandidate.step_no) {
      return step;
    }

    if (step.status === 'pending') {
      return {
        ...step,
        status: 'in_progress' as const,
      };
    }

    return step;
  });

  const promotedCurrent = promotedSteps.find((step) => step.step_no === nextCandidate.step_no);
  const currentStatus = currentStatusFromStep(promotedCurrent) ?? 'in_progress';

  return {
    ...state,
    updated_at: nowIso,
    current_step_no: nextCandidate.step_no,
    current_step_status: currentStatus,
    steps: promotedSteps,
  };
}

export function readCurrentStepName(state: WorkflowExecutionState): string {
  return (
    state.steps.find((step) => step.step_no === state.current_step_no)?.step_name ?? 'Workflow step'
  );
}

export function upsertRuntimeExecutionState(
  params: UpsertRuntimeExecutionStateParams,
): WorkflowExecutionState {
  const baseState =
    readWorkflowExecutionState(params.existingState) ??
    createInitialState(params.planningPlan, params.nowIso);

  return applyTransition(baseState, params.runtimeStepId, params.transition, params.nowIso);
}
