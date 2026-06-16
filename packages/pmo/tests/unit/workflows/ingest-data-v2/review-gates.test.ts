import { describe, expect, it } from 'vitest';
import { shouldBlockPublishApprove } from '../../../../src/backend/workflows/ingest-data-v2/review-gates.ts';

describe('shouldBlockPublishApprove', () => {
  it('returns true when blocking issues exist even if duplicate_in_upload is zero', () => {
    const blocked = shouldBlockPublishApprove({
      hasBlockingIssues: true,
      changeSummary: [
        {
          tableId: 'resource_allocation',
          counts: {
            new_records: 2,
            updated_records: 1,
            exact_duplicates: 0,
            duplicates_in_upload: 0,
          },
          sampleChanges: [
            {
              type: 'updated_record',
              naturalKey: {
                member_id: 'EMP-001',
                project_id: 'PRJ-001',
              },
              newValues: {
                allocation_pct: 0.75,
              },
            },
          ],
        },
      ],
    });

    expect(blocked).toBe(true);
  });
});
