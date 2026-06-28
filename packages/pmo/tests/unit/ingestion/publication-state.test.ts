import { describe, expect, it } from 'vitest';
import { isPublishedIngestionSession } from '../../../src/backend/ingestion/publication-state.ts';

describe('isPublishedIngestionSession', () => {
  it('accepts status published without publish_decision', () => {
    expect(
      isPublishedIngestionSession({
        status: 'published',
        publish_decision: null,
      }),
    ).toBe(true);
  });

  it('accepts publish_decision approved when workflow advanced past published', () => {
    expect(
      isPublishedIngestionSession({
        status: 'report_generated',
        publish_decision: 'approved',
      }),
    ).toBe(true);
  });

  it('rejects sessions that never passed publish review', () => {
    expect(
      isPublishedIngestionSession({
        status: 'awaiting_publish_review',
        publish_decision: null,
      }),
    ).toBe(false);
  });
});
