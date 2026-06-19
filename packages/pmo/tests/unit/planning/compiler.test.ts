import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadPmoPlannerCatalog,
  resetPmoPlannerCatalogCacheForTests,
} from '../../../src/backend/planning/catalog.ts';
import { compilePmoWorkflowSteps } from '../../../src/backend/planning/compiler.ts';

const originalCwd = process.cwd();
const originalCatalogDir = process.env.PMO_PLANNER_CATALOG_DIR;
const repoRoot = path.resolve(import.meta.dirname, '../../../../..');

afterEach(() => {
  resetPmoPlannerCatalogCacheForTests();
  process.chdir(originalCwd);
  if (originalCatalogDir === undefined) delete process.env.PMO_PLANNER_CATALOG_DIR;
  else process.env.PMO_PLANNER_CATALOG_DIR = originalCatalogDir;
});

function actions(
  dataSourceMode: 'existing_db' | 'uploaded_file',
  actionMode: Parameters<typeof compilePmoWorkflowSteps>[0]['actionMode'],
) {
  return compilePmoWorkflowSteps({
    dataSourceMode,
    actionMode,
    candidateSteps: [],
  }).compiled_workflow.map((step) => step.action_id);
}

describe('PMO multi-axis workflow compiler', () => {
  it('compiles uploaded-file outcomes to deterministic prefixes', () => {
    expect(actions('uploaded_file', 'inspect_file')).toEqual(['workbook_profiling']);
    expect(actions('uploaded_file', 'review_staging')).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
    ]);
    expect(actions('uploaded_file', 'validate')).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
    ]);
    expect(actions('uploaded_file', 'preview_changes')).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
    ]);
  });

  it('adds canonical writes only for publish outcomes', () => {
    expect(actions('uploaded_file', 'publish')).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
      'publish_after_approval',
    ]);
    expect(actions('uploaded_file', 'publish_then_report')).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
      'publish_after_approval',
      'generate_report',
    ]);
  });

  it('compiles an existing database report without workbook steps', () => {
    expect(actions('existing_db', 'generate_report')).toEqual(['generate_report']);
  });

  it('compiles uploaded-file generate_report to staging preview pipeline', () => {
    expect(actions('uploaded_file', 'generate_report')).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'generate_report',
    ]);
  });

  it('drops invented model steps but retains complete deterministic workflow', () => {
    const result = compilePmoWorkflowSteps({
      dataSourceMode: 'uploaded_file',
      actionMode: 'inspect_file',
      candidateSteps: [
        {
          step_no: 1,
          step_name: 'Document summary',
          description: 'Invented step.',
          requires_user_review: false,
        },
        {
          step_no: 2,
          step_name: 'Publish',
          action_id: 'publish_after_approval',
          review_type: 'publish',
          requires_user_review: true,
        },
      ],
    });

    expect(result.compiled_workflow.map((step) => step.action_id)).toEqual(['workbook_profiling']);
    expect(result.diagnostics).toContain('dropped_step_without_catalog_action:Document summary');
    expect(result.diagnostics).toContain('dropped_step_outside_intent:publish_after_approval');
  });

  it('loads axis catalog from JSON', () => {
    const catalog = loadPmoPlannerCatalog();
    expect(catalog.default_intent).toEqual({
      dataSourceMode: 'uploaded_file',
      actionMode: 'preview_changes',
    });
    expect(catalog.valid_combinations).toContainEqual(
      expect.objectContaining({ dataSourceMode: 'uploaded_file', actionMode: 'validate' }),
    );
    expect(catalog.steps.find((step) => step.action_id === 'normalize_to_staging')).toMatchObject({
      allowed_action_modes: expect.arrayContaining(['validate', 'review_staging']),
    });
  });

  it('loads catalog from PMO_PLANNER_CATALOG_DIR outside repo root', () => {
    process.chdir('/tmp');
    process.env.PMO_PLANNER_CATALOG_DIR = path.join(repoRoot, 'config', 'ingestion-planner', 'pmo');
    expect(loadPmoPlannerCatalog().steps.map((step) => step.action_id)).toContain(
      'workbook_profiling',
    );
  });
});
