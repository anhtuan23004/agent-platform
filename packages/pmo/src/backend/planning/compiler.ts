import {
  getIntentDefinition,
  getStepDefinition,
  loadPmoPlannerCatalog,
  type PmoIntentMode,
  type PmoPlannerCatalog,
} from './catalog.ts';
import type { PmoWorkflowPlan } from './plan-schema.ts';
import type { PlannerStepLike, PmoPlanActionId, PmoReviewType } from './step-metadata.ts';

export interface CompilePmoWorkflowInput {
  intentMode: PmoIntentMode;
  candidateSteps: Array<
    PlannerStepLike & {
      agent_responsibility?: unknown;
      user_responsibility?: unknown;
    }
  >;
  catalog?: PmoPlannerCatalog;
}

export interface CompiledPmoWorkflowStep {
  step_no: number;
  planner_step_id: string;
  action_id: PmoPlanActionId;
  review_type: PmoReviewType;
  step_name: string;
  description: string;
  agent_responsibility: string;
  user_responsibility: string;
  requires_user_review: boolean;
}

export interface CompilePmoWorkflowResult {
  compiled_workflow: CompiledPmoWorkflowStep[];
  diagnostics: string[];
}

function isStringActionId(value: unknown): value is PmoPlanActionId {
  return (
    value === 'workbook_profiling' ||
    value === 'column_mapping' ||
    value === 'normalize_to_staging' ||
    value === 'database_change_summary' ||
    value === 'publish_after_approval' ||
    value === 'generate_report' ||
    value === 'generic_review'
  );
}

function stepIdFor(index: number, actionId: PmoPlanActionId): string {
  return `pmo.planner.step.${index}.${actionId}`;
}

function buildFallbackStep(
  catalog: PmoPlannerCatalog,
  actionId: PmoPlanActionId,
  stepNo: number,
): CompiledPmoWorkflowStep | null {
  const definition = getStepDefinition(catalog, actionId);
  if (!definition) return null;

  return {
    step_no: stepNo,
    planner_step_id: stepIdFor(stepNo, actionId),
    action_id: actionId,
    review_type: definition.review_type,
    step_name: definition.step_name,
    description: definition.objective,
    agent_responsibility: definition.agent_responsibility,
    user_responsibility: definition.user_responsibility,
    requires_user_review: definition.default_requires_user_review,
  };
}

export function compilePmoWorkflowSteps(input: CompilePmoWorkflowInput): CompilePmoWorkflowResult {
  const catalog = input.catalog ?? loadPmoPlannerCatalog();
  const intent = getIntentDefinition(catalog, input.intentMode);
  const allowed = new Set<PmoPlanActionId>(intent.allowed_action_ids);
  const allowedOrder = new Map<PmoPlanActionId, number>(
    intent.allowed_action_ids.map((actionId, index) => [actionId, index]),
  );
  const diagnostics: string[] = [];
  const byAction = new Map<
    PmoPlanActionId,
    PlannerStepLike & {
      agent_responsibility?: unknown;
      user_responsibility?: unknown;
    }
  >();

  for (const step of input.candidateSteps) {
    if (!isStringActionId(step.action_id)) {
      diagnostics.push(`dropped_step_without_catalog_action:${step.step_name}`);
      continue;
    }

    if (step.action_id === 'generic_review') {
      diagnostics.push(`dropped_unsupported_generic_review:${step.step_name}`);
      continue;
    }

    if (!allowed.has(step.action_id)) {
      diagnostics.push(`dropped_step_outside_intent:${step.action_id}`);
      continue;
    }

    if (!getStepDefinition(catalog, step.action_id)) {
      diagnostics.push(`dropped_unknown_catalog_step:${step.action_id}`);
      continue;
    }

    if (byAction.has(step.action_id)) {
      diagnostics.push(`collapsed_duplicate_step:${step.action_id}`);
      continue;
    }

    byAction.set(step.action_id, step);
  }

  const actionIds =
    byAction.size > 0
      ? [...byAction.keys()].sort((a, b) => (allowedOrder.get(a) ?? 0) - (allowedOrder.get(b) ?? 0))
      : [...intent.allowed_action_ids];

  const compiled = actionIds
    .map((actionId, index): CompiledPmoWorkflowStep | null => {
      const definition = getStepDefinition(catalog, actionId);
      if (!definition) return null;
      const step = byAction.get(actionId);
      const stepNo = index + 1;

      return {
        step_no: stepNo,
        planner_step_id: stepIdFor(stepNo, actionId),
        action_id: actionId,
        review_type: definition.review_type,
        step_name: definition.step_name,
        description:
          typeof step?.description === 'string' && step.description.trim().length > 0
            ? step.description.trim()
            : definition.objective,
        agent_responsibility:
          typeof step?.agent_responsibility === 'string' &&
          step.agent_responsibility.trim().length > 0
            ? step.agent_responsibility.trim()
            : definition.agent_responsibility,
        user_responsibility:
          typeof step?.user_responsibility === 'string' &&
          step.user_responsibility.trim().length > 0
            ? step.user_responsibility.trim()
            : definition.user_responsibility,
        requires_user_review:
          typeof step?.requires_user_review === 'boolean'
            ? step.requires_user_review
            : definition.default_requires_user_review,
      };
    })
    .filter((step): step is CompiledPmoWorkflowStep => Boolean(step));

  if (compiled.length === 0) {
    const fallbackIntent = getIntentDefinition(catalog, catalog.default_intent_mode);
    const fallbackAction = fallbackIntent.allowed_action_ids[0];
    const fallback = fallbackAction ? buildFallbackStep(catalog, fallbackAction, 1) : null;
    if (fallback) compiled.push(fallback);
  }

  return {
    compiled_workflow: compiled,
    diagnostics,
  };
}

export function applyCompiledWorkflowToPlan(
  plan: PmoWorkflowPlan,
  params: {
    intentMode: PmoIntentMode;
  },
): PmoWorkflowPlan {
  const compiled = compilePmoWorkflowSteps({
    intentMode: params.intentMode,
    candidateSteps: plan.proposed_workflow,
  });

  return {
    ...plan,
    proposed_workflow: compiled.compiled_workflow,
    compiled_workflow: compiled.compiled_workflow,
    state_management_plan: {
      ...plan.state_management_plan,
      state_to_save: [
        ...new Set([
          ...plan.state_management_plan.state_to_save,
          'intent_analysis',
          'compiled_workflow',
          'planner_diagnostics',
        ]),
      ],
    },
  };
}
