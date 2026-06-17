import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { PmoPlanActionId, PmoReviewType } from './step-metadata.ts';

export const PMO_INTENT_MODES = [
  'review_only',
  'mapping_readiness',
  'stage_preview',
  'publish_intent',
] as const;

export type PmoIntentMode = (typeof PMO_INTENT_MODES)[number];

export const IntentConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type IntentConfidence = z.infer<typeof IntentConfidenceSchema>;

export interface PmoPlannerStepDefinition {
  action_id: PmoPlanActionId;
  step_name: string;
  review_type: PmoReviewType;
  objective: string;
  agent_responsibility: string;
  user_responsibility: string;
  default_requires_user_review: boolean;
  allowed_intent_modes: PmoIntentMode[];
  requires_prior_checkpoint: string[];
  produces: string[];
}

export interface PmoIntentDefinition {
  intent_mode: PmoIntentMode;
  label: string;
  description: string;
  allowed_action_ids: PmoPlanActionId[];
}

export interface PmoPlannerExampleDefinition {
  goal: string;
  intent_mode: PmoIntentMode;
  allowed_action_ids: PmoPlanActionId[];
  expected_title: string;
  expected_goal_summary: string;
}

export interface PmoPlannerCatalog {
  version: string;
  default_intent_mode: PmoIntentMode;
  low_confidence_requires_confirmation: boolean;
  intents: PmoIntentDefinition[];
  steps: PmoPlannerStepDefinition[];
  examples: PmoPlannerExampleDefinition[];
}

const ActionIdSchema = z.enum([
  'workbook_profiling',
  'column_mapping',
  'normalize_to_staging',
  'database_change_summary',
  'publish_after_approval',
]);

const IntentModeSchema = z.enum(PMO_INTENT_MODES);

const ReviewTypeSchema = z.enum(['none', 'profiling', 'mapping', 'normalization', 'publish']);

const StepDefinitionSchema = z.object({
  action_id: ActionIdSchema,
  step_name: z.string().min(1),
  review_type: ReviewTypeSchema,
  objective: z.string().min(1),
  agent_responsibility: z.string().min(1),
  user_responsibility: z.string().min(1),
  default_requires_user_review: z.boolean(),
  allowed_intent_modes: z.array(IntentModeSchema).min(1),
  requires_prior_checkpoint: z.array(z.string().min(1)),
  produces: z.array(z.string().min(1)),
});

const StepsFileSchema = z.object({
  version: z.string().min(1),
  steps: z.array(StepDefinitionSchema).min(1),
});

const IntentDefinitionSchema = z.object({
  intent_mode: IntentModeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  allowed_action_ids: z.array(ActionIdSchema).min(1),
});

const IntentsFileSchema = z.object({
  version: z.string().min(1),
  default_intent_mode: IntentModeSchema,
  low_confidence_requires_confirmation: z.boolean(),
  intents: z.array(IntentDefinitionSchema).min(1),
});

const ExampleDefinitionSchema = z.object({
  goal: z.string().min(1),
  intent_mode: IntentModeSchema,
  allowed_action_ids: z.array(ActionIdSchema).min(1),
  expected_title: z.string().min(1),
  expected_goal_summary: z.string().min(1),
});

const ExamplesFileSchema = z.object({
  version: z.string().min(1),
  examples: z.array(ExampleDefinitionSchema).min(1),
});

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

let cachedCatalog: PmoPlannerCatalog | null = null;

export function loadPmoPlannerCatalog(): PmoPlannerCatalog {
  if (cachedCatalog) return cachedCatalog;

  const root = findRepoRoot(process.cwd());
  const baseDir = path.join(root, 'config', 'ingestion-planner', 'pmo');
  const stepsFile = StepsFileSchema.parse(readJsonFile(path.join(baseDir, 'steps.json')));
  const intentsFile = IntentsFileSchema.parse(readJsonFile(path.join(baseDir, 'intents.json')));
  const examplesFile = ExamplesFileSchema.parse(readJsonFile(path.join(baseDir, 'examples.json')));

  const stepIds = new Set(stepsFile.steps.map((step) => step.action_id));
  const issues: string[] = [];

  for (const intent of intentsFile.intents) {
    for (const actionId of intent.allowed_action_ids) {
      if (!stepIds.has(actionId)) {
        issues.push(`intent ${intent.intent_mode} references unknown action ${actionId}`);
      }
    }
  }

  for (const example of examplesFile.examples) {
    for (const actionId of example.allowed_action_ids) {
      if (!stepIds.has(actionId)) {
        issues.push(`example ${example.goal} references unknown action ${actionId}`);
      }
    }
  }

  if (
    !intentsFile.intents.some((intent) => intent.intent_mode === intentsFile.default_intent_mode)
  ) {
    issues.push(`default intent ${intentsFile.default_intent_mode} is not defined`);
  }

  if (issues.length > 0) {
    throw new Error(`PMO planner catalog validation failed:\n${issues.join('\n')}`);
  }

  cachedCatalog = {
    version: stepsFile.version,
    default_intent_mode: intentsFile.default_intent_mode,
    low_confidence_requires_confirmation: intentsFile.low_confidence_requires_confirmation,
    intents: intentsFile.intents,
    steps: stepsFile.steps,
    examples: examplesFile.examples,
  };

  return cachedCatalog;
}

export function resetPmoPlannerCatalogCacheForTests(): void {
  cachedCatalog = null;
}

export function getIntentDefinition(
  catalog: PmoPlannerCatalog,
  intentMode: PmoIntentMode,
): PmoIntentDefinition {
  const exact = catalog.intents.find((intent) => intent.intent_mode === intentMode);
  if (exact) return exact;

  const fallback = catalog.intents.find(
    (intent) => intent.intent_mode === catalog.default_intent_mode,
  );
  if (fallback) return fallback;

  const first = catalog.intents[0];
  if (!first) {
    throw new Error('pmo_planner_intents_empty');
  }

  return first;
}

export function getStepDefinition(
  catalog: PmoPlannerCatalog,
  actionId: PmoPlanActionId,
): PmoPlannerStepDefinition | null {
  return catalog.steps.find((step) => step.action_id === actionId) ?? null;
}
