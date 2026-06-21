import { Agent } from '@mastra/core/agent';
import { loadPmoPlannerCatalog, type PmoPlannerCatalog } from './catalog.ts';
import { compilePmoWorkflowSteps } from './compiler.ts';
import type { ClassifiedPmoIntent } from './intent-classifier.ts';
import { type PmoWorkflowPlan, PmoWorkflowPlanSchema } from './plan-schema.ts';

interface UploadedFileInput {
  file_name: string;
  file_size: string;
  uploaded_at: string;
  file_type: string;
}

interface WorkflowCapabilitiesInput {
  can_parse_excel_workbook: boolean;
  can_detect_sheet_roles: boolean;
  can_propose_column_mappings: boolean;
  can_normalize_to_staging: boolean;
  can_compare_with_existing_database: boolean;
  can_generate_db_change_summary: boolean;
  can_publish_after_user_approval: boolean;
}

export interface GeneratePmoPlanInput {
  goal: string;
  intent: ClassifiedPmoIntent;
  uploaded_file: UploadedFileInput | null;
  workflow_capabilities: WorkflowCapabilitiesInput;
  previous_plan?: unknown;
  plan_feedback?: string;
}

function buildDynamicPlanningPrompt(params: {
  catalog: PmoPlannerCatalog;
  intent: ClassifiedPmoIntent;
}): string {
  const allowed = new Set(params.intent.allowed_action_ids);
  const allowedSteps = params.catalog.steps
    .filter((step) => allowed.has(step.action_id))
    .map((step) => ({
      action_id: step.action_id,
      step_name: step.step_name,
      review_type: step.review_type,
      objective: step.objective,
      agent_responsibility: step.agent_responsibility,
      user_responsibility: step.user_responsibility,
      default_requires_user_review: step.default_requires_user_review,
      requires_prior_checkpoint: step.requires_prior_checkpoint,
      produces: step.produces,
    }));
  const examples = params.catalog.examples
    .filter(
      (example) =>
        example.dataSourceMode === params.intent.dataSourceMode &&
        example.actionMode === params.intent.actionMode,
    )
    .slice(0, 2);

  return `You are a PMO workflow planning agent.

Generate a high-level, reviewable execution plan from the provided intent analysis, workflow step catalog, examples, user goal, and file metadata.

At this stage, an uploaded Excel file has not been parsed yet. The input may have no file for a database-only report. You only know the user's goal, optional file metadata, and the pre-classified intent.

Intent analysis:
${JSON.stringify(params.intent, null, 2)}

Allowed workflow steps:
${JSON.stringify(allowedSteps, null, 2)}

Relevant examples:
${JSON.stringify(examples, null, 2)}

Rules:
- Return exactly one JSON object that matches the schema.
- Include intent_analysis exactly as provided.
- Every proposed_workflow item must use one of the allowed workflow steps above.
- Use the configured step_name, review_type, objective, agent_responsibility, user_responsibility, and default_requires_user_review as the source of truth.
- Do not invent workflow steps. Summaries and document checks belong inside the relevant allowed step description.
- Do not add downstream steps outside the allowed workflow steps.
- Do not claim workbook parsing, mapping, normalization, database comparison, or publishing has already happened.
- Set uploaded_file_summary to null when uploaded_file is null.
- Do not invent sheet names, column names, row counts, data quality issues, mapping results, or database changes.
- If intent_analysis.requires_confirmation is true, make next_action ask the user to confirm or refine the intended scope before approval.
- Keep concise but complete.
- Do not include markdown.
- Do not include explanatory text outside the JSON object.`;
}

function resolvePlanningModel(): string {
  const direct = process.env.PMO_PLAN_MODEL?.trim();
  if (direct) {
    return direct;
  }

  const defaultModel = process.env.AGENT_MODEL_DEFAULT?.trim();
  if (defaultModel && defaultModel !== 'auto') {
    return defaultModel;
  }

  const catalogRaw = process.env.AGENT_MODELS?.trim();
  if (catalogRaw) {
    const first = catalogRaw
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)[0];

    if (first) {
      const tierSuffixMatch = first.match(/:(fast|balanced|reasoning)$/);
      if (tierSuffixMatch) {
        return first.slice(0, -tierSuffixMatch[0].length);
      }
      return first;
    }
  }

  return 'openai/gpt-5.5';
}

function applyPlannerPostProcessing(params: {
  plan: PmoWorkflowPlan;
  intent: ClassifiedPmoIntent;
  catalog: PmoPlannerCatalog;
}): PmoWorkflowPlan {
  const compiled = compilePmoWorkflowSteps({
    dataSourceMode: params.intent.dataSourceMode,
    actionMode: params.intent.actionMode,
    candidateSteps: params.plan.proposed_workflow,
    catalog: params.catalog,
  });

  return {
    ...params.plan,
    intent_analysis: params.intent,
    proposed_workflow: compiled.compiled_workflow,
    compiled_workflow: compiled.compiled_workflow,
    next_action: params.intent.requires_confirmation
      ? {
          label: 'Confirm intent',
          description:
            'Confirm the intended workflow scope or regenerate the plan with clearer feedback before approval.',
        }
      : params.plan.next_action,
    state_management_plan: {
      ...params.plan.state_management_plan,
      state_to_save: [
        ...new Set([
          ...params.plan.state_management_plan.state_to_save,
          'intent_analysis',
          'compiled_workflow',
          'planner_diagnostics',
        ]),
      ],
    },
  };
}

export async function generatePmoWorkflowPlan(
  input: GeneratePmoPlanInput,
): Promise<PmoWorkflowPlan> {
  const model = resolvePlanningModel();
  const catalog = loadPmoPlannerCatalog();
  const intent = input.intent;
  const planner = new Agent({
    id: 'pmo.workflowPlanner',
    name: 'PMO Workflow Planner',
    instructions: buildDynamicPlanningPrompt({ catalog, intent }),
    model,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 55_000);

  try {
    const result = await planner.generate(
      JSON.stringify({
        ...input,
        intent_analysis: intent,
        allowed_action_ids: intent.allowed_action_ids,
      }),
      {
        modelSettings: { maxOutputTokens: 4096, temperature: 0 },
        abortSignal: ac.signal,
        structuredOutput: { schema: PmoWorkflowPlanSchema },
      },
    );

    if (!result.object) {
      throw new Error('planning_model_no_structured_output');
    }

    return applyPlannerPostProcessing({
      plan: result.object,
      intent,
      catalog,
    });
  } finally {
    clearTimeout(timer);
  }
}
