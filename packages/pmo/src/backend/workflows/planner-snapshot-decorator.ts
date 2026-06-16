import type { WorkflowSnapshotDecoratorSpec } from '@seta/agent-sdk';
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';
import {
  type PmoPlanActionId,
  RUNTIME_STEP_ACTION_PREFERENCES,
  readPlannerWorkflowSteps,
} from '../planning/step-metadata.ts';

interface PlannerStep {
  step_no: number;
  planner_step_id: string;
  action_id: PmoPlanActionId;
  review_type: string;
  step_name: string;
  description: string;
}

type GraphStepStatus = 'pending' | 'running' | 'suspended' | 'success' | 'failed' | 'skipped';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readIngestionSessionId(inputSummary: unknown): string | null {
  if (!isObject(inputSummary)) return null;

  const direct = inputSummary.ingestionSessionId;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();

  const snake = inputSummary.ingestion_session_id;
  if (typeof snake === 'string' && snake.trim().length > 0) return snake.trim();

  return null;
}

function readPlannerSteps(planningPlan: unknown): PlannerStep[] {
  return readPlannerWorkflowSteps(planningPlan).map((step) => ({
    step_no: step.step_no,
    planner_step_id: step.planner_step_id,
    action_id: step.action_id,
    review_type: step.review_type,
    step_name: step.step_name,
    description: typeof step.description === 'string' ? step.description.trim() : '',
  }));
}

function readExecutionState(executionState: unknown): {
  statusByStepNo: Map<number, string>;
  currentStepNo: number | null;
  currentStepStatus: string | null;
} {
  const statusByStepNo = new Map<number, string>();

  if (!isObject(executionState)) {
    return {
      statusByStepNo,
      currentStepNo: null,
      currentStepStatus: null,
    };
  }

  const currentStepNo =
    typeof executionState.current_step_no === 'number' &&
    Number.isFinite(executionState.current_step_no)
      ? Math.trunc(executionState.current_step_no)
      : null;
  const currentStepStatus =
    typeof executionState.current_step_status === 'string'
      ? executionState.current_step_status
      : null;

  const rawSteps = executionState.steps;
  if (!Array.isArray(rawSteps)) {
    return {
      statusByStepNo,
      currentStepNo,
      currentStepStatus,
    };
  }

  for (const rawStep of rawSteps) {
    if (!isObject(rawStep)) continue;

    const stepNo = rawStep.step_no;
    const status = rawStep.status;

    if (typeof stepNo !== 'number' || !Number.isFinite(stepNo)) continue;
    if (typeof status !== 'string' || status.length === 0) continue;

    statusByStepNo.set(Math.trunc(stepNo), status);
  }

  return {
    statusByStepNo,
    currentStepNo,
    currentStepStatus,
  };
}

function readRuntimeStepStatuses(snapshot: Record<string, unknown>): Array<[string, string]> {
  const rawContext = snapshot.context;
  if (!isObject(rawContext)) return [];

  const statuses: Array<[string, string]> = [];
  for (const [stepId, rawEntry] of Object.entries(rawContext)) {
    if (stepId === 'input' || stepId === '__state') continue;
    if (!isObject(rawEntry)) continue;

    const status = rawEntry.status;
    if (typeof status !== 'string' || status.length === 0) continue;

    statuses.push([stepId, status]);
  }

  return statuses;
}

function plannerStepMatchesRuntimeStep(plannerStep: PlannerStep, runtimeStepId: string): boolean {
  const runtime = runtimeStepId.toLowerCase();
  const stepName = plannerStep.step_name.toLowerCase();

  if (runtime.includes('confirmmapping')) {
    if (plannerStep.action_id === 'column_mapping') return true;
    return /mapping|confirm/.test(stepName);
  }

  if (runtime.includes('normalize')) {
    if (plannerStep.action_id === 'normalize_to_staging') return true;
    return /normalize|staging|diff|validate|validation|data\s*quality|duplicate|anomal/.test(
      stepName,
    );
  }

  if (runtime.includes('reviewchanges')) {
    if (
      RUNTIME_STEP_ACTION_PREFERENCES['pmo.ingest.reviewChanges'].some(
        (actionId) => actionId === plannerStep.action_id,
      )
    ) {
      return true;
    }
    return /review|readiness|impact|database|publish/.test(stepName);
  }

  if (runtime.includes('detect')) {
    if (plannerStep.action_id === 'workbook_profiling') return true;
    return /profil|schema|detect/.test(stepName);
  }

  const runtimeTail = runtime.replace(/^.*\./, '');
  return runtimeTail.length > 0 ? stepName.includes(runtimeTail) : false;
}

function mapExecutionStatusToGraphStatus(
  executionStatus: string | null | undefined,
  runStatus: string,
): GraphStepStatus {
  const normalized = (executionStatus ?? '').toLowerCase();

  if (normalized === 'failed' || normalized === 'error') return 'failed';
  if (normalized === 'completed' || normalized === 'success') return 'success';
  if (normalized === 'in_progress' || normalized === 'running') return 'running';
  if (normalized === 'needs_review' || normalized === 'paused' || normalized === 'suspended') {
    return 'suspended';
  }

  const run = runStatus.toLowerCase();
  if (
    (run === 'canceled' || run === 'cancelled') &&
    normalized !== 'success' &&
    normalized !== 'failed'
  ) {
    return 'skipped';
  }

  if (normalized === 'cancelled' || normalized === 'canceled') return 'skipped';
  return 'pending';
}

function mapRuntimeStatusesToGraphStatus(
  runtimeStatuses: string[],
  runStatus: string,
): GraphStepStatus {
  const normalized = runtimeStatuses.map((status) => status.toLowerCase());

  if (normalized.some((status) => status === 'failed' || status === 'error')) {
    return 'failed';
  }
  if (normalized.some((status) => status === 'success' || status === 'completed')) {
    return 'success';
  }
  if (normalized.some((status) => status === 'suspended' || status === 'paused')) {
    return 'suspended';
  }
  if (normalized.some((status) => status === 'running' || status === 'in_progress')) {
    return 'running';
  }

  const run = runStatus.toLowerCase();
  if (run === 'canceled' || run === 'cancelled') return 'skipped';

  return 'pending';
}

function plannerGraphStepId(step: PlannerStep): string {
  return `${step.step_no}. ${step.step_name}`;
}

export const pmoPlannerSnapshotDecorator: WorkflowSnapshotDecoratorSpec = {
  id: 'pmo.planner.snapshot-graph',
  workflowIds: ['pmo.ingestData', 'ingestData'],
  decorate: async ({ inputSummary, runStatus, snapshot, tenantId }) => {
    const ingestionSessionId = readIngestionSessionId(inputSummary);
    if (!ingestionSessionId) return snapshot;

    const db = pmoDb();
    const rows = await db
      .select({
        planning_plan: ingestionSessions.planning_plan,
        workflow_execution_state: ingestionSessions.workflow_execution_state,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestionSessionId),
          eq(ingestionSessions.tenant_id, tenantId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return snapshot;

    const plannerSteps = readPlannerSteps(row.planning_plan);
    if (plannerSteps.length === 0) return snapshot;

    const runtimeStepStatuses = readRuntimeStepStatuses(snapshot);
    const execution = readExecutionState(row.workflow_execution_state);
    const plannerContext: Record<string, unknown> = isObject(snapshot.context)
      ? { ...snapshot.context }
      : {};

    const serializedStepGraph = plannerSteps.map((step) => {
      const stepId = plannerGraphStepId(step);

      let graphStatus: GraphStepStatus;
      const executionStatus =
        execution.statusByStepNo.get(step.step_no) ??
        (execution.currentStepNo === step.step_no ? execution.currentStepStatus : null);

      if (executionStatus) {
        graphStatus = mapExecutionStatusToGraphStatus(executionStatus, runStatus);
      } else {
        const matchedRuntimeStatuses = runtimeStepStatuses
          .filter(([runtimeStepId]) => plannerStepMatchesRuntimeStep(step, runtimeStepId))
          .map(([, status]) => status);

        graphStatus = mapRuntimeStatusesToGraphStatus(matchedRuntimeStatuses, runStatus);
      }

      plannerContext[stepId] = {
        status: graphStatus,
      };

      return {
        type: 'step',
        step: {
          id: stepId,
          description: step.description || `Planner step ${step.step_no}`,
        },
      };
    });

    return {
      ...snapshot,
      serializedStepGraph,
      context: plannerContext,
    };
  },
};

export const __testExports = {
  readPlannerSteps,
  readExecutionState,
  plannerStepMatchesRuntimeStep,
  mapExecutionStatusToGraphStatus,
  mapRuntimeStatusesToGraphStatus,
};
