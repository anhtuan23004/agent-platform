import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { PmoPlanActionId, PmoReviewType } from './step-metadata.ts';

export const PMO_DATA_SOURCE_MODES = ['existing_db', 'uploaded_file'] as const;
export type PmoDataSourceMode = (typeof PMO_DATA_SOURCE_MODES)[number];

export const PMO_ACTION_MODES = [
  'inspect_file',
  'review_staging',
  'validate',
  'preview_changes',
  'publish',
  'generate_report',
  'publish_then_report',
] as const;
export type PmoActionMode = (typeof PMO_ACTION_MODES)[number];

export const PMO_WRITE_POLICIES = ['read_only', 'requires_approval'] as const;
export type PmoWritePolicy = (typeof PMO_WRITE_POLICIES)[number];

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
  allowed_action_modes: PmoActionMode[];
  requires_prior_checkpoint: string[];
  produces: string[];
}

export interface PmoValidIntentCombination {
  dataSourceMode: PmoDataSourceMode;
  actionMode: PmoActionMode;
  label: string;
  description: string;
}

export interface PmoPlannerExampleDefinition {
  goal: string;
  dataSourceMode: PmoDataSourceMode;
  actionMode: PmoActionMode;
  writePolicy: PmoWritePolicy;
  expected_title: string;
  expected_goal_summary: string;
}

export interface PmoClassificationRuleDefinition {
  rule: string;
}

export interface PmoPlannerCatalog {
  version: string;
  default_intent: Pick<PmoValidIntentCombination, 'dataSourceMode' | 'actionMode'>;
  low_confidence_requires_confirmation: boolean;
  valid_combinations: PmoValidIntentCombination[];
  steps: PmoPlannerStepDefinition[];
  examples: PmoPlannerExampleDefinition[];
  classification_rules: PmoClassificationRuleDefinition[];
}

const ActionIdSchema = z.enum([
  'workbook_profiling',
  'column_mapping',
  'normalize_to_staging',
  'database_change_summary',
  'publish_after_approval',
  'generate_report',
]);

const DataSourceModeSchema = z.enum(PMO_DATA_SOURCE_MODES);
const ActionModeSchema = z.enum(PMO_ACTION_MODES);
const WritePolicySchema = z.enum(PMO_WRITE_POLICIES);

const ReviewTypeSchema = z.enum([
  'none',
  'profiling',
  'mapping',
  'normalization',
  'publish',
  'report',
]);

const StepDefinitionSchema = z.object({
  action_id: ActionIdSchema,
  step_name: z.string().min(1),
  review_type: ReviewTypeSchema,
  objective: z.string().min(1),
  agent_responsibility: z.string().min(1),
  user_responsibility: z.string().min(1),
  default_requires_user_review: z.boolean(),
  allowed_action_modes: z.array(ActionModeSchema).min(1),
  requires_prior_checkpoint: z.array(z.string().min(1)),
  produces: z.array(z.string().min(1)),
});

const StepsFileSchema = z.object({
  version: z.string().min(1),
  steps: z.array(StepDefinitionSchema).min(1),
});

const ValidCombinationSchema = z.object({
  dataSourceMode: DataSourceModeSchema,
  actionMode: ActionModeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
});

const IntentsFileSchema = z.object({
  version: z.string().min(1),
  default_intent: z.object({
    dataSourceMode: DataSourceModeSchema,
    actionMode: ActionModeSchema,
  }),
  low_confidence_requires_confirmation: z.boolean(),
  valid_combinations: z.array(ValidCombinationSchema).min(1),
});

const ExampleDefinitionSchema = z.object({
  goal: z.string().min(1),
  dataSourceMode: DataSourceModeSchema,
  actionMode: ActionModeSchema,
  writePolicy: WritePolicySchema,
  expected_title: z.string().min(1),
  expected_goal_summary: z.string().min(1),
});

const ExamplesFileSchema = z.object({
  version: z.string().min(1),
  examples: z.array(ExampleDefinitionSchema).min(1),
});

const ClassificationRuleDefinitionSchema = z.object({
  rule: z.string().min(1),
});

const ClassificationRulesFileSchema = z.object({
  version: z.string().min(1),
  classification_rules: z.array(ClassificationRuleDefinitionSchema).min(1),
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

function catalogDirHasRequiredFiles(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'steps.json')) &&
    fs.existsSync(path.join(dir, 'intents.json')) &&
    fs.existsSync(path.join(dir, 'examples.json')) &&
    fs.existsSync(path.join(dir, 'classification-rules.json'))
  );
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of paths) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function resolvePmoPlannerCatalogDir(): string {
  const configuredDir = process.env.PMO_PLANNER_CATALOG_DIR?.trim();
  const repoRoot = findRepoRoot(process.cwd());
  const appHome = process.env.APP_HOME?.trim();

  const candidates = uniquePaths(
    [
      configuredDir,
      path.join(repoRoot, 'config', 'ingestion-planner', 'pmo'),
      appHome ? path.join(appHome, 'config', 'ingestion-planner', 'pmo') : null,
      path.resolve(process.cwd(), '..', '..', 'config', 'ingestion-planner', 'pmo'),
    ].filter((value): value is string => Boolean(value)),
  );

  for (const candidate of candidates) {
    if (catalogDirHasRequiredFiles(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `PMO planner catalog not found. Tried: ${candidates.join(', ')}. ` +
      'Set PMO_PLANNER_CATALOG_DIR to a directory containing steps.json, intents.json, examples.json, and classification-rules.json.',
  );
}

let cachedCatalog: PmoPlannerCatalog | null = null;

export function loadPmoPlannerCatalog(): PmoPlannerCatalog {
  if (cachedCatalog) return cachedCatalog;

  const baseDir = resolvePmoPlannerCatalogDir();
  const stepsFile = StepsFileSchema.parse(readJsonFile(path.join(baseDir, 'steps.json')));
  const intentsFile = IntentsFileSchema.parse(readJsonFile(path.join(baseDir, 'intents.json')));
  const examplesFile = ExamplesFileSchema.parse(readJsonFile(path.join(baseDir, 'examples.json')));
  const classificationRulesFile = ClassificationRulesFileSchema.parse(
    readJsonFile(path.join(baseDir, 'classification-rules.json')),
  );

  const issues: string[] = [];
  if (
    !intentsFile.valid_combinations.some(
      (intent) =>
        intent.dataSourceMode === intentsFile.default_intent.dataSourceMode &&
        intent.actionMode === intentsFile.default_intent.actionMode,
    )
  ) {
    issues.push('default multi-axis intent is not defined');
  }

  if (issues.length > 0) {
    throw new Error(`PMO planner catalog validation failed:\n${issues.join('\n')}`);
  }

  cachedCatalog = {
    version: stepsFile.version,
    default_intent: intentsFile.default_intent,
    low_confidence_requires_confirmation: intentsFile.low_confidence_requires_confirmation,
    valid_combinations: intentsFile.valid_combinations,
    steps: stepsFile.steps,
    examples: examplesFile.examples,
    classification_rules: classificationRulesFile.classification_rules,
  };

  return cachedCatalog;
}

export function resetPmoPlannerCatalogCacheForTests(): void {
  cachedCatalog = null;
}

export function getIntentDefinition(
  catalog: PmoPlannerCatalog,
  dataSourceMode: PmoDataSourceMode,
  actionMode: PmoActionMode,
): PmoValidIntentCombination {
  const exact = catalog.valid_combinations.find(
    (intent) => intent.dataSourceMode === dataSourceMode && intent.actionMode === actionMode,
  );
  if (exact) return exact;

  const fallback = catalog.valid_combinations.find(
    (intent) =>
      intent.dataSourceMode === catalog.default_intent.dataSourceMode &&
      intent.actionMode === catalog.default_intent.actionMode,
  );
  if (fallback) return fallback;

  const first = catalog.valid_combinations[0];
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
