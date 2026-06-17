import { describe, expect, it } from 'vitest';
import { buildClassifiedPmoIntentForTests } from '../../../src/backend/planning/intent-classifier.ts';

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
    expect(intent.allowed_action_ids).toContain('publish_after_approval');
  });
});
