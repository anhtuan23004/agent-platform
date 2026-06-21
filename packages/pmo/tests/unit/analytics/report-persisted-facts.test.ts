import { describe, expect, it, vi } from 'vitest';
import {
  type GeneratePmoReportDeps,
  generatePmoReport,
} from '../../../src/backend/analytics/report.ts';
import type { MemberWeekFact, Thresholds, WeekRow } from '../../../src/backend/analytics/types.ts';

const THRESHOLDS: Thresholds = {
  overbookThreshold: 1.1,
  overbookRedThreshold: 1.2,
  idleThreshold: 0.75,
  idleYellowThreshold: 0.85,
  mismatchPctThreshold: 0.2,
  otMaxHoursPerWeek: 48,
  requiredTrainingHours: 0,
};

const WEEK: WeekRow = {
  week_id: 'W1',
  week_start: new Date('2026-06-29T00:00:00.000Z'),
  week_end: new Date('2026-07-05T00:00:00.000Z'),
  working_days: 5,
  holiday_hours_ft: 0,
};

const FACT: MemberWeekFact = {
  memberId: 'EMP-001',
  weekId: 'W1',
  scopeStatus: 'IN_SCOPE',
  availableHours: 40,
  plannedHours: 48,
  loggedHours: 44,
  expectedLoggedHours: 48,
  billableHours: 44,
  benchHours: 0,
  overtimeHours: 0,
  trainingHours: 0,
  busyRate: 1.2,
  utilization: 1.1,
  billableRate: 1,
  benchRate: 0,
  overtimeRatio: 0,
  effortConsumption: 0.9167,
  trainingCompliance: null,
  ragColor: 'red',
  issueType: 'overbook',
};

describe('generatePmoReport persisted-facts contract', () => {
  it('ensures freshness then reads bounded persisted facts without rebuilding canonical inputs', async () => {
    const ensureFacts = vi.fn(async () => ({
      factCount: 1,
      memberCount: 1,
      weekIds: ['W1'],
      thresholds: THRESHOLDS,
      computedAt: new Date('2026-08-07T12:00:00.000Z'),
      ingestionSessionId: null,
      recomputed: false,
      factsVersion: 'facts-v1',
      canonicalDataVersion: 'canonical-v1',
    }));
    const loadEvidence = vi.fn(async () => ({
      facts: [FACT],
      ctx: { leaves: [], weeksById: new Map([['W1', WEEK]]), thresholds: THRESHOLDS },
    }));
    const deps: GeneratePmoReportDeps = { ensureFacts, loadEvidence };

    const result = await generatePmoReport(
      {
        tenantId: '00000000-0000-0000-0000-000000000001',
        dateRange: { from: '2026-06-29', to: '2026-07-05' },
        reportTypes: ['overbook_members'],
      },
      deps,
    );

    expect(ensureFacts).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', {
      force: false,
    });
    expect(loadEvidence).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', {
      dateRange: {
        from: new Date('2026-06-29T00:00:00.000Z'),
        to: new Date('2026-07-05T00:00:00.000Z'),
      },
    });
    expect(result.summary).toMatchObject({ memberCount: 1, overbookCount: 1, idleCount: 0 });
    expect(result.findings[0]?.metricEvidence).toEqual({
      N01: 1.2,
      N02: 1.1,
      N03: 1,
      N04: 0,
      N05: 0,
      N06: 0.9167,
      N12: null,
    });
    expect(result.sourceVersion).toEqual({
      factsVersion: 'facts-v1',
      canonicalDataVersion: 'canonical-v1',
      factsComputedAt: '2026-08-07T12:00:00.000Z',
    });
  });

  it('rejects staging preview as report input', async () => {
    await expect(
      generatePmoReport(
        {
          tenantId: '00000000-0000-0000-0000-000000000001',
          ingestionSessionId: '00000000-0000-0000-0000-000000000002',
          dateRange: { from: '2026-06-29', to: '2026-07-05' },
          reportTypes: ['overbook_members'],
          reportSource: 'staging_preview',
        },
        { ensureFacts: vi.fn(), loadEvidence: vi.fn() } as never,
      ),
    ).rejects.toThrow('report_staging_preview_not_supported');
  });
});
