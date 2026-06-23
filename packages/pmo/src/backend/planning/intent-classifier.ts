import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  IntentConfidenceSchema,
  loadPmoPlannerCatalog,
  PMO_ACTION_MODES,
  PMO_DATA_SOURCE_MODES,
  PMO_WRITE_POLICIES,
  type PmoActionMode,
  type PmoDataSourceMode,
  type PmoPlannerCatalog,
  type PmoWritePolicy,
} from './catalog.ts';
import { actionIdsForPmoIntent } from './compiler.ts';
import type { PmoPlanActionId } from './step-metadata.ts';

const DateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const PmoIntentClassificationSchema = z.object({
  dataSourceMode: z.enum(PMO_DATA_SOURCE_MODES),
  actionMode: z.enum(PMO_ACTION_MODES),
  writePolicy: z.enum(PMO_WRITE_POLICIES),
  confidence: IntentConfidenceSchema,
  rationale: z.string().min(1),
  extractedDateRange: DateRangeSchema.nullable().optional(),
  extractedReportTypes: z
    .array(z.enum(['idle_members', 'overbook_members', 'forward_allocation']))
    .min(1)
    .optional(),
});

export type PmoIntentClassification = z.infer<typeof PmoIntentClassificationSchema>;

export interface PmoIntentResolutionOption {
  id: 'report_existing_db' | 'publish_then_report' | 'preview_only';
  label: string;
  description: string;
  dataSourceMode: PmoDataSourceMode;
  actionMode: PmoActionMode;
}

export interface ClassifiedPmoIntent extends PmoIntentClassification {
  requires_confirmation: boolean;
  allowed_action_ids: PmoPlanActionId[];
  resolution_options?: PmoIntentResolutionOption[];
}

export interface PmoIntentValidationContext {
  hasUploadedFile: boolean;
  hasActiveStagingSession?: boolean;
  planFeedback?: string;
}

function resolvePlanningModel(): string {
  const direct = process.env.PMO_PLAN_MODEL?.trim();
  if (direct) return direct;
  const defaultModel = process.env.AGENT_MODEL_DEFAULT?.trim();
  if (defaultModel && defaultModel !== 'auto') return defaultModel;
  const first = process.env.AGENT_MODELS?.split(',')
    .map((v) => v.trim())
    .filter(Boolean)[0];
  return first?.replace(/:(fast|balanced|reasoning)$/, '') || 'openai/gpt-5.5';
}

function buildIntentPrompt(catalog: PmoPlannerCatalog): string {
  return `You classify PMO workflow intent from user goal text and file context.

Return exactly one structured object. User may write in any language.

Valid combinations:
${JSON.stringify(catalog.valid_combinations, null, 2)}

Examples:
${JSON.stringify(catalog.examples, null, 2)}

Classification rules:
${catalog.classification_rules.map(({ rule }) => `- ${rule}`).join('\n')}

Rules:
- Choose narrowest actionMode satisfying explicit requested outcome.
- Use has_uploaded_file to distinguish uploaded_file from existing_db.
- writePolicy is read_only except publish and publish_then_report, which require approval.
- Use confidence low when request reasonably fits multiple outcomes.
- Extract date range and report types only when explicitly stated. Never invent dates.
- Do not resolve dates or ask questions. Date resolution belongs to generate_report step.
- If plan_feedback is provided, it overrides or refines the original goal. Treat it as the user's updated intent. For example, feedback like "also publish" should widen actionMode to include publish steps.`;
}

function derivedWritePolicy(actionMode: PmoActionMode): PmoWritePolicy {
  return actionMode === 'publish' || actionMode === 'publish_then_report'
    ? 'requires_approval'
    : 'read_only';
}

export function validatePmoPlanningIntent(
  catalog: PmoPlannerCatalog,
  classification: PmoIntentClassification,
  context: PmoIntentValidationContext,
): ClassifiedPmoIntent {
  let next = { ...classification, writePolicy: derivedWritePolicy(classification.actionMode) };
  let forcedConfirmation = false;

  if (next.dataSourceMode === 'uploaded_file' && !context.hasUploadedFile) {
    next = {
      ...next,
      dataSourceMode: 'existing_db',
      actionMode: 'generate_report',
      writePolicy: 'read_only',
      rationale: `${next.rationale} Uploaded-file action unavailable without a workbook.`,
    };
    forcedConfirmation = true;
  }

  const invalidExistingDbAction =
    next.dataSourceMode === 'existing_db' &&
    ['inspect_file', 'review_staging', 'validate', 'publish', 'publish_then_report'].includes(
      next.actionMode,
    );
  if (invalidExistingDbAction) {
    next = {
      ...next,
      actionMode: 'generate_report',
      writePolicy: 'read_only',
      rationale: `${next.rationale} File-specific action unavailable for existing DB source.`,
    };
    forcedConfirmation = true;
  }

  if (
    next.dataSourceMode === 'existing_db' &&
    next.actionMode === 'preview_changes' &&
    !context.hasActiveStagingSession
  ) {
    next = {
      ...next,
      actionMode: 'generate_report',
      rationale: `${next.rationale} No active staged session exists for change preview.`,
    };
    forcedConfirmation = true;
  }

  const allowedActionIds = actionIdsForPmoIntent(next.dataSourceMode, next.actionMode);

  return {
    ...next,
    writePolicy: derivedWritePolicy(next.actionMode),
    allowed_action_ids: allowedActionIds,
    requires_confirmation:
      forcedConfirmation ||
      (catalog.low_confidence_requires_confirmation && next.confidence === 'low'),
  };
}

export async function classifyPmoPlanningIntent(
  goal: string,
  context: PmoIntentValidationContext = { hasUploadedFile: true },
): Promise<ClassifiedPmoIntent> {
  const catalog = loadPmoPlannerCatalog();
  const model = resolvePlanningModel();
  const classifier = new Agent({
    id: 'pmo.workflowIntentClassifier',
    name: 'PMO Workflow Intent Classifier',
    instructions: buildIntentPrompt(catalog),
    model,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);

  try {
    const classifierInput: Record<string, unknown> = {
      goal,
      has_uploaded_file: context.hasUploadedFile,
    };
    if (context.planFeedback) {
      classifierInput.plan_feedback = context.planFeedback;
    }
    const result = await classifier.generate(JSON.stringify(classifierInput), {
      abortSignal: controller.signal,
      modelSettings: { temperature: 0 },
      structuredOutput: { schema: PmoIntentClassificationSchema },
      providerOptions: { openai: { reasoningSummary: 'auto' } },
    });
    if (!result.object) {
      const preview = result.text?.slice(0, 500) ?? '(empty)';
      throw new Error(
        `Intent classifier (model=${model}) returned no structured output. Raw: ${preview}`,
      );
    }
    return validatePmoPlanningIntent(catalog, result.object, context);
  } finally {
    clearTimeout(timer);
  }
}

export function buildClassifiedPmoIntentForTests(
  input: Omit<PmoIntentClassification, 'rationale'> & { rationale?: string },
  context?: Partial<PmoIntentValidationContext>,
): ClassifiedPmoIntent {
  return validatePmoPlanningIntent(
    loadPmoPlannerCatalog(),
    { ...input, rationale: input.rationale ?? 'test classification' },
    {
      hasUploadedFile: context?.hasUploadedFile ?? input.dataSourceMode === 'uploaded_file',
      hasActiveStagingSession: context?.hasActiveStagingSession ?? false,
    },
  );
}
