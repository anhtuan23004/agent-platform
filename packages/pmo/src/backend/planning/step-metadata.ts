export const PMO_PLAN_ACTION_IDS = [
  'workbook_profiling',
  'column_mapping',
  'normalize_to_staging',
  'database_change_summary',
  'publish_after_approval',
  'generic_review',
] as const;

export type PmoPlanActionId = (typeof PMO_PLAN_ACTION_IDS)[number];

export const PMO_REVIEW_TYPES = [
  'none',
  'profiling',
  'mapping',
  'normalization',
  'publish',
  'generic',
] as const;

export type PmoReviewType = (typeof PMO_REVIEW_TYPES)[number];

export interface PmoPlannerStepMetadata {
  planner_step_id: string;
  action_id: PmoPlanActionId;
  review_type: PmoReviewType;
}

export interface PlannerStepLike {
  step_no: number;
  step_name: string;
  description?: string;
  action_id?: unknown;
  planner_step_id?: unknown;
  review_type?: unknown;
  requires_user_review?: unknown;
}

export const RUNTIME_STEP_ACTION_PREFERENCES = {
  'pmo.ingest.detect': ['workbook_profiling'],
  'pmo.ingest.confirmMapping': ['column_mapping'],
  'pmo.ingest.normalizeToStaging': ['normalize_to_staging'],
  'pmo.ingest.reviewChanges': ['publish_after_approval', 'database_change_summary'],
} as const satisfies Record<string, readonly PmoPlanActionId[]>;

export type RuntimeStepActionId = keyof typeof RUNTIME_STEP_ACTION_PREFERENCES;

function isPmoPlanActionId(value: unknown): value is PmoPlanActionId {
  return typeof value === 'string' && PMO_PLAN_ACTION_IDS.includes(value as PmoPlanActionId);
}

function isPmoReviewType(value: unknown): value is PmoReviewType {
  return typeof value === 'string' && PMO_REVIEW_TYPES.includes(value as PmoReviewType);
}

function normalizeSearchText(step: PlannerStepLike): string {
  return `${step.step_name} ${typeof step.description === 'string' ? step.description : ''}`
    .trim()
    .toLowerCase();
}

export function derivePmoActionId(step: PlannerStepLike): PmoPlanActionId {
  if (isPmoPlanActionId(step.action_id)) return step.action_id;

  const text = normalizeSearchText(step);

  if (/publish|final\s*approval|apply\s+approved|write\s+target|upsert/.test(text)) {
    return 'publish_after_approval';
  }

  if (
    /normaliz|staging|clean|transform|validate|validation|data\s*quality|duplicate|anomal/.test(
      text,
    )
  ) {
    return 'normalize_to_staging';
  }

  if (/column|field|mapping|map\s+proposal|schema\s+align|reconcile/.test(text)) {
    return 'column_mapping';
  }

  if (/database|db\s+change|change\s+summary|comparison|diff|impact|readiness/.test(text)) {
    return 'database_change_summary';
  }

  if (/workbook|profil|detect|sheet\s+role|parse/.test(text)) {
    return 'workbook_profiling';
  }

  return step.requires_user_review === true ? 'generic_review' : 'workbook_profiling';
}

export function reviewTypeForPmoAction(actionId: PmoPlanActionId): PmoReviewType {
  if (actionId === 'workbook_profiling') return 'profiling';
  if (actionId === 'column_mapping') return 'mapping';
  if (actionId === 'normalize_to_staging') return 'normalization';
  if (actionId === 'database_change_summary' || actionId === 'publish_after_approval') {
    return 'publish';
  }
  return 'generic';
}

export function derivePmoReviewType(
  step: PlannerStepLike,
  actionId: PmoPlanActionId,
): PmoReviewType {
  if (isPmoReviewType(step.review_type)) return step.review_type;
  if (step.requires_user_review === false && actionId !== 'workbook_profiling') return 'none';
  return reviewTypeForPmoAction(actionId);
}

export function derivePlannerStepId(step: PlannerStepLike, actionId: PmoPlanActionId): string {
  if (typeof step.planner_step_id === 'string' && step.planner_step_id.trim().length > 0) {
    return step.planner_step_id.trim();
  }

  return `pmo.planner.step.${Math.trunc(step.step_no)}.${actionId}`;
}

export function enrichPlannerStep<T extends PlannerStepLike>(step: T): T & PmoPlannerStepMetadata {
  const actionId = derivePmoActionId(step);
  return {
    ...step,
    planner_step_id: derivePlannerStepId(step, actionId),
    action_id: actionId,
    review_type: derivePmoReviewType(step, actionId),
  };
}

export function enrichPlannerWorkflowSteps<T extends PlannerStepLike>(
  steps: T[],
): Array<T & PmoPlannerStepMetadata> {
  return steps.map((step) => enrichPlannerStep(step));
}

export function readPlannerWorkflowSteps(
  planningPlan: unknown,
): Array<PlannerStepLike & PmoPlannerStepMetadata> {
  if (!planningPlan || typeof planningPlan !== 'object' || Array.isArray(planningPlan)) return [];

  const proposedWorkflow = (planningPlan as { proposed_workflow?: unknown }).proposed_workflow;
  if (!Array.isArray(proposedWorkflow)) return [];

  return proposedWorkflow
    .map((step): (PlannerStepLike & PmoPlannerStepMetadata) | null => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
      const raw = step as PlannerStepLike;
      if (typeof raw.step_no !== 'number' || !Number.isFinite(raw.step_no)) return null;
      if (typeof raw.step_name !== 'string' || raw.step_name.trim().length === 0) return null;

      return enrichPlannerStep({
        ...raw,
        step_no: Math.trunc(raw.step_no),
        step_name: raw.step_name.trim(),
      });
    })
    .filter((step): step is PlannerStepLike & PmoPlannerStepMetadata => Boolean(step))
    .sort((a, b) => a.step_no - b.step_no);
}

export function findPlannerStepForRuntime(
  planningPlan: unknown,
  runtimeStepId: RuntimeStepActionId,
): (PlannerStepLike & PmoPlannerStepMetadata) | null {
  const steps = readPlannerWorkflowSteps(planningPlan);
  const preferredActions = RUNTIME_STEP_ACTION_PREFERENCES[runtimeStepId];

  for (const actionId of preferredActions) {
    const match = steps.find((step) => step.action_id === actionId);
    if (match) return match;
  }

  return null;
}
