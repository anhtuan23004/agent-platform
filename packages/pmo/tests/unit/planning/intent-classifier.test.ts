import { describe, expect, it } from 'vitest';
import {
  buildClassifiedPmoIntentForTests,
  PmoIntentClassificationSchema,
} from '../../../src/backend/planning/intent-classifier.ts';

describe('PMO planner intent confirmation policy', () => {
  it('requires user confirmation for low-confidence intent classification', () => {
    const intent = buildClassifiedPmoIntentForTests('review_only', 'low');

    expect(intent.intent_mode).toBe('review_only');
    expect(intent.confidence).toBe('low');
    expect(intent.requires_confirmation).toBe(true);
    expect(intent.allowed_action_ids).toEqual(['workbook_profiling']);
  });

  it('does not require user confirmation for high-confidence intent classification', () => {
    const intent = buildClassifiedPmoIntentForTests('publish_intent', 'high');

    expect(intent.intent_mode).toBe('publish_intent');
    expect(intent.confidence).toBe('high');
    expect(intent.requires_confirmation).toBe(false);
    expect(intent.allowed_action_ids).toContain('database_change_summary');
  });

  it('accepts a database report intent with an LLM-extracted explicit date range', () => {
    const result = PmoIntentClassificationSchema.parse({
      intent_mode: 'generate_report_intent',
      confidence: 'high',
      rationale: 'The user asked for a report from existing PMO data.',
      report_request: {
        source: 'database',
        date_range_strategy: 'explicit',
        date_range: { from: '2026-01-01', to: '2026-03-31' },
        report_types: ['idle_members', 'overbook_members'],
      },
    });

    expect(result.report_request?.date_range).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('accepts an ingest-and-report intent that needs a sheet-or-database range choice', () => {
    const result = PmoIntentClassificationSchema.parse({
      intent_mode: 'publish_report_intent',
      confidence: 'high',
      rationale: 'The user asked to ingest a workbook and then report without dates.',
      report_request: {
        source: 'post_ingest_database',
        date_range_strategy: 'sheet_or_database_confirmation',
        date_range: null,
        report_types: ['idle_members', 'overbook_members'],
      },
    });

    expect(result.report_request?.date_range_strategy).toBe('sheet_or_database_confirmation');
  });

  it('requires intent-card confirmation when report date selection is incomplete', () => {
    const intent = buildClassifiedPmoIntentForTests('generate_report_intent', 'high', {
      source: 'database',
      date_range_strategy: 'database_confirmation',
      date_range: null,
      report_types: ['idle_members', 'overbook_members'],
    });

    expect(intent.requires_confirmation).toBe(true);
  });

  it('does not require date confirmation for an explicit report range', () => {
    const intent = buildClassifiedPmoIntentForTests('generate_report_intent', 'high', {
      source: 'database',
      date_range_strategy: 'explicit',
      date_range: { from: '2026-01-01', to: '2026-01-31' },
      report_types: ['idle_members'],
    });

    expect(intent.requires_confirmation).toBe(false);
  });
});
