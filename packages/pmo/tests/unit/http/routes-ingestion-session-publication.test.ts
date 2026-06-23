import { describe, expect, it } from 'vitest';
import { isPublishedIngestionSession } from '../../../src/backend/http/routes.ts';

describe('PMO ingestion session publication state', () => {
  it('treats sessions that completed after publish as published', () => {
    expect(
      isPublishedIngestionSession({
        status: 'report_generated',
        publish_decision: 'approved',
      }),
    ).toBe(true);
  });

  it('does not treat execution completion without publish approval as published', () => {
    expect(
      isPublishedIngestionSession({
        status: 'reviewed',
        publish_decision: null,
      }),
    ).toBe(false);
  });
});
