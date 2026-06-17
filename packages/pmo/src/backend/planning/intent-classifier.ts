import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  getIntentDefinition,
  IntentConfidenceSchema,
  loadPmoPlannerCatalog,
  type PmoIntentMode,
  type PmoPlannerCatalog,
} from './catalog.ts';
import type { PmoPlanActionId } from './step-metadata.ts';

export const PmoIntentClassificationSchema = z.object({
  intent_mode: z.enum(['review_only', 'mapping_readiness', 'stage_preview', 'publish_intent']),
  confidence: IntentConfidenceSchema,
  rationale: z.string().min(1),
});

export type PmoIntentClassification = z.infer<typeof PmoIntentClassificationSchema>;

export interface ClassifiedPmoIntent extends PmoIntentClassification {
  requires_confirmation: boolean;
  allowed_action_ids: PmoPlanActionId[];
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

function buildIntentPrompt(catalog: PmoPlannerCatalog): string {
  const examples = catalog.examples.map((example) => ({
    goal: example.goal,
    intent_mode: example.intent_mode,
    allowed_action_ids: example.allowed_action_ids,
  }));
  const classificationRules = catalog.classification_rules.map((entry) => entry.rule);

  return `You classify PMO ingestion planning intent from user goal text.

Return exactly one structured object.

Use the intent definitions, decision rules, and examples below. The user may write in any language. Do not translate the user's goal in the output.

Intent definitions:
${JSON.stringify(
  catalog.intents.map((intent) => ({
    intent_mode: intent.intent_mode,
    description: intent.description,
    allowed_action_ids: intent.allowed_action_ids,
  })),
  null,
  2,
)}

Examples:
${JSON.stringify(examples, null, 2)}

Classification rules:
${classificationRules.map((rule) => `- ${rule}`).join('\n')}

Rules:
- Use the configured intent descriptions as the source of truth.
- Classify by the deepest outcome the user explicitly asks for, not by every downstream step that could eventually happen.
- Choose the narrowest intent that satisfies the user's requested outcome.
- Do not expand the scope beyond what the user actually asked for.
- Use confidence low when the goal is ambiguous or could reasonably fit more than one intent.
- Low confidence means the user must confirm the intended scope before execution.`;
}

function applyConfirmationPolicy(
  catalog: PmoPlannerCatalog,
  classification: PmoIntentClassification,
): ClassifiedPmoIntent {
  const intent = getIntentDefinition(catalog, classification.intent_mode as PmoIntentMode);
  return {
    ...classification,
    allowed_action_ids: intent.allowed_action_ids,
    requires_confirmation:
      catalog.low_confidence_requires_confirmation && classification.confidence === 'low',
  };
}

function lowConfidenceFallback(catalog: PmoPlannerCatalog, reason: string): ClassifiedPmoIntent {
  const intent = getIntentDefinition(catalog, catalog.default_intent_mode);
  return {
    intent_mode: intent.intent_mode,
    confidence: 'low',
    rationale: reason,
    allowed_action_ids: intent.allowed_action_ids,
    requires_confirmation: catalog.low_confidence_requires_confirmation,
  };
}

export async function classifyPmoPlanningIntent(goal: string): Promise<ClassifiedPmoIntent> {
  const catalog = loadPmoPlannerCatalog();
  const model = resolvePlanningModel();
  const classifier = new Agent({
    id: 'pmo.workflowIntentClassifier',
    name: 'PMO Workflow Intent Classifier',
    instructions: buildIntentPrompt(catalog),
    model,
  });

  try {
    const result = await classifier.generate(
      JSON.stringify({
        goal,
        default_intent_mode: catalog.default_intent_mode,
      }),
      {
        structuredOutput: { schema: PmoIntentClassificationSchema },
        providerOptions: { openai: { reasoningSummary: 'auto', temperature: 0 } },
      },
    );

    if (!result.object) {
      return lowConfidenceFallback(catalog, 'Intent classifier returned no structured output.');
    }

    return applyConfirmationPolicy(catalog, result.object);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return lowConfidenceFallback(catalog, `Intent classifier failed: ${message}`);
  }
}

export function buildClassifiedPmoIntentForTests(
  intentMode: PmoIntentMode,
  confidence: 'low' | 'medium' | 'high' = 'high',
): ClassifiedPmoIntent {
  const catalog = loadPmoPlannerCatalog();
  return applyConfirmationPolicy(catalog, {
    intent_mode: intentMode,
    confidence,
    rationale: 'test classification',
  });
}
