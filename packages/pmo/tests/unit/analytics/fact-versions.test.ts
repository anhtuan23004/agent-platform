import { describe, expect, it } from 'vitest';
import {
  buildCanonicalDataVersion,
  buildFactsVersion,
} from '../../../src/backend/analytics/fact-versions.ts';

describe('persisted fact versions', () => {
  const input = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    tableWatermarks: {
      member_master: new Date('2026-06-20T10:00:00.000Z'),
      calendar_weeks: new Date('2026-06-19T10:00:00.000Z'),
    },
    latestPublishedSessionId: '00000000-0000-0000-0000-000000000002',
    latestPublishedAt: new Date('2026-06-20T11:00:00.000Z'),
  };

  it('is stable regardless of watermark key order', () => {
    const reversed = {
      ...input,
      tableWatermarks: {
        calendar_weeks: input.tableWatermarks.calendar_weeks,
        member_master: input.tableWatermarks.member_master,
      },
    };
    expect(buildCanonicalDataVersion(input)).toBe(buildCanonicalDataVersion(reversed));
  });

  it('changes facts version when canonical input or schema changes', () => {
    const canonical = buildCanonicalDataVersion(input);
    const changedCanonical = buildCanonicalDataVersion({
      ...input,
      tableWatermarks: { ...input.tableWatermarks, member_master: new Date() },
    });

    expect(
      buildFactsVersion({ tenantId: input.tenantId, canonicalDataVersion: canonical }),
    ).not.toBe(
      buildFactsVersion({ tenantId: input.tenantId, canonicalDataVersion: changedCanonical }),
    );
    expect(
      buildFactsVersion({
        tenantId: input.tenantId,
        canonicalDataVersion: canonical,
        factsSchemaVersion: 'next-schema',
      }),
    ).not.toBe(buildFactsVersion({ tenantId: input.tenantId, canonicalDataVersion: canonical }));
    expect(
      buildFactsVersion({
        tenantId: input.tenantId,
        canonicalDataVersion: canonical,
        factsRuleVersion: 'rules-v2',
      }),
    ).not.toBe(buildFactsVersion({ tenantId: input.tenantId, canonicalDataVersion: canonical }));
  });
});
