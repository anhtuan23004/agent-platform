import { describe, expect, it } from 'vitest';
import {
  buildClassifiedPmoIntentForTests,
  PmoIntentClassificationSchema,
} from '../../../src/backend/planning/intent-classifier.ts';

describe('PMO multi-axis intent validation', () => {
  it('derives read-only policy and deterministic review scope', () => {
    const intent = buildClassifiedPmoIntentForTests({
      dataSourceMode: 'uploaded_file',
      actionMode: 'preview_changes',
      writePolicy: 'requires_approval',
      confidence: 'high',
    });

    expect(intent.writePolicy).toBe('read_only');
    expect(intent.allowed_action_ids).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
    ]);
    expect(intent.requires_confirmation).toBe(false);
  });

  it('forces approval policy for publish outcomes', () => {
    const intent = buildClassifiedPmoIntentForTests({
      dataSourceMode: 'uploaded_file',
      actionMode: 'publish_then_report',
      writePolicy: 'read_only',
      confidence: 'high',
    });

    expect(intent.writePolicy).toBe('requires_approval');
    expect(intent.allowed_action_ids).toContain('publish_after_approval');
    expect(intent.allowed_action_ids.at(-1)).toBe('generate_report');
  });

  it('requires confirmation for low confidence', () => {
    const intent = buildClassifiedPmoIntentForTests({
      dataSourceMode: 'uploaded_file',
      actionMode: 'inspect_file',
      writePolicy: 'read_only',
      confidence: 'low',
    });
    expect(intent.requires_confirmation).toBe(true);
  });

  it('allows uploaded-file report as staging preview pipeline', () => {
    const intent = buildClassifiedPmoIntentForTests({
      dataSourceMode: 'uploaded_file',
      actionMode: 'generate_report',
      writePolicy: 'read_only',
      confidence: 'high',
    });

    expect(intent.requires_confirmation).toBe(false);
    expect(intent.resolution_options).toBeUndefined();
    expect(intent.allowed_action_ids).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'generate_report',
    ]);
    expect(intent.writePolicy).toBe('read_only');
  });

  it('redirects invalid existing-db file actions to safe report confirmation', () => {
    const intent = buildClassifiedPmoIntentForTests({
      dataSourceMode: 'existing_db',
      actionMode: 'inspect_file',
      writePolicy: 'read_only',
      confidence: 'high',
    });

    expect(intent.dataSourceMode).toBe('existing_db');
    expect(intent.actionMode).toBe('generate_report');
    expect(intent.requires_confirmation).toBe(true);
  });

  it('extracts explicit report hints without resolving them', () => {
    const result = PmoIntentClassificationSchema.parse({
      dataSourceMode: 'existing_db',
      actionMode: 'generate_report',
      writePolicy: 'read_only',
      confidence: 'high',
      rationale: 'Database report requested.',
      extractedDateRange: { from: '2026-01-01', to: '2026-03-31' },
      extractedReportTypes: ['idle_members', 'overbook_members'],
    });

    expect(result.extractedDateRange?.from).toBe('2026-01-01');
  });

  it('accepts forward allocation as an extracted report type', () => {
    const result = PmoIntentClassificationSchema.parse({
      dataSourceMode: 'uploaded_file',
      actionMode: 'publish_then_report',
      writePolicy: 'requires_approval',
      confidence: 'high',
      rationale: 'Demand-backed forward allocation report requested.',
      extractedReportTypes: ['forward_allocation'],
    });

    expect(result.extractedReportTypes).toEqual(['forward_allocation']);
  });
});
