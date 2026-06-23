import { describe, expect, it } from 'vitest';
import {
  dateRangesOverlap,
  filterReportOutputByWeek,
  parseOpportunityActivePeriod,
  recommendationGroupOverlapsWeek,
  resolveWeekBounds,
} from '../../../../src/backend/reporting/recommendations/filter-by-week.ts';
<<<<<<< HEAD
import type { GeneratePmoReportOutput } from '../../../../src/backend/reporting/report-output.ts';

function finding(
  memberId: string,
  issueWeeks: NonNullable<GeneratePmoReportOutput['findings'][number]['issueWeeks']>,
): GeneratePmoReportOutput['findings'][number] {
=======
import type { WorkloadReportOutput } from '../../../../src/backend/reporting/report-output.ts';

function finding(
  memberId: string,
  excludedWeeks: WorkloadReportOutput['findings'][number]['excludedWeeks'] = [],
): WorkloadReportOutput['findings'][number] {
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
  return {
    memberId,
    issueType: 'overbook',
    ragColor: 'red',
    busyRate: 1.2,
    effortConsumption: 1,
    detail: 'overbook',
<<<<<<< HEAD
    excludedWeeks: [],
    issueWeeks,
=======
    excludedWeeks,
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
    annotations: [],
    reviewRequired: true,
    suggestedActionCode: 'REBALANCE_ALLOCATION',
    suggestedActions: [],
    metricEvidence: {
      N01: 1.2,
      N02: 1,
      N03: 1,
      N04: 0,
      N05: 0,
      N06: 1,
      N12: null,
    },
  };
}

function group(
  opportunityId: string,
  sourceMemberId: string,
<<<<<<< HEAD
): GeneratePmoReportOutput['recommendations'][number] {
=======
): WorkloadReportOutput['recommendations'][number] {
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
  return {
    opportunityId,
    sourceMemberId,
    projectId: 'PRJ-1',
    roleNeeded: 'BE',
    severity: 'red',
    evidenceWindow: { from: '2026-06-29', to: '2026-08-07' },
    planningPeriod: { from: '2026-08-10', to: '2026-09-30' },
    currentRaBusyRate: 1.2,
    targetRaBusyRate: 1,
    requiredReductionPct: 0.2,
    requiredReductionHoursPerWeek: 8,
    status: 'full_solution',
    requiresRaConfirmation: false,
    noResultReasons: [],
    recommendationDegraded: false,
    dataQualityFlags: [],
    evidenceVersions: {
      sourceVersions: ['v1'],
      embeddingModelIds: [],
      embeddingSourceHashes: [],
    },
    recommendations: [],
  };
}

describe('filter-by-week', () => {
<<<<<<< HEAD
  it('resolves week bounds from issue week evidence', () => {
    expect(
      resolveWeekBounds('W2', [
        finding('EMP-001', [
          {
            weekId: 'W2',
            weekStart: '2026-07-06',
            weekEnd: '2026-07-12',
            issueType: 'overbook',
            ragColor: 'red',
            availableHours: 40,
            plannedHours: 48,
            loggedHours: 40,
            busyRate: 1.2,
            effortConsumption: 1,
          },
        ]),
      ]),
    ).toEqual({
=======
  it('resolves week bounds from the report date range', () => {
    expect(resolveWeekBounds('W2', { from: '2026-06-29', to: '2026-07-20' })).toEqual({
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
      weekId: 'W2',
      weekStart: '2026-07-06',
      weekEnd: '2026-07-12',
    });
  });

  it('parses active period from opportunity id', () => {
    expect(parseOpportunityActivePeriod('EMP-001:PRJ-1:BE:2026-07-06:2026-08-07')).toEqual({
      from: '2026-07-06',
      to: '2026-08-07',
    });
  });

  it('filters findings and recommendations to a week context', () => {
    const report = {
<<<<<<< HEAD
      findings: [
        finding('EMP-001', [
          {
            weekId: 'W2',
            weekStart: '2026-07-06',
            weekEnd: '2026-07-12',
            issueType: 'overbook',
            ragColor: 'red',
            availableHours: 40,
            plannedHours: 48,
            loggedHours: 40,
            busyRate: 1.2,
            effortConsumption: 1,
          },
        ]),
        finding('EMP-003', [
          {
            weekId: 'W4',
            weekStart: '2026-07-20',
            weekEnd: '2026-07-26',
            issueType: 'overbook',
            ragColor: 'yellow',
            availableHours: 40,
            plannedHours: 45,
            loggedHours: 40,
            busyRate: 1.12,
            effortConsumption: 1,
          },
        ]),
      ],
=======
      dateRange: { from: '2026-06-29', to: '2026-07-26' },
      findings: [finding('EMP-001'), finding('EMP-003')],
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
      recommendations: [
        group('EMP-001:PRJ-1:BE:2026-07-06:2026-08-07', 'EMP-001'),
        group('EMP-003:PRJ-2:DE:2026-07-20:2026-08-07', 'EMP-003'),
      ],
    };

    expect(filterReportOutputByWeek(report, 'W2')).toEqual({
      findings: [report.findings[0]],
      recommendations: [report.recommendations[0]],
    });
  });

<<<<<<< HEAD
  it('throws when week id is not present in report evidence', () => {
    expect(() =>
      filterReportOutputByWeek(
        {
          findings: [
            finding('EMP-001', [
              {
                weekId: 'W1',
                weekStart: '2026-06-29',
                weekEnd: '2026-07-05',
                issueType: 'overbook',
                ragColor: 'red',
                availableHours: 40,
                plannedHours: 48,
                loggedHours: 40,
                busyRate: 1.2,
                effortConsumption: 1,
              },
            ]),
          ],
=======
  it('throws when week id is outside the report range', () => {
    expect(() =>
      filterReportOutputByWeek(
        {
          dateRange: { from: '2026-06-29', to: '2026-07-05' },
          findings: [finding('EMP-001')],
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
          recommendations: [],
        },
        'W9',
      ),
    ).toThrow('unknown_week_id:W9');
  });

<<<<<<< HEAD
=======
  it('excludes findings when the selected week was suppressed', () => {
    const report = {
      dateRange: { from: '2026-06-29', to: '2026-07-12' },
      findings: [finding('EMP-001', [{ weekId: 'W1', reason: 'approved_ot' }])],
      recommendations: [group('EMP-001:PRJ-1:BE:2026-06-29:2026-07-05', 'EMP-001')],
    };

    expect(filterReportOutputByWeek(report, 'W1')).toEqual({
      findings: [],
      recommendations: [report.recommendations[0]],
    });
  });

>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
  it('detects overlap between opportunity period and week bounds', () => {
    expect(
      recommendationGroupOverlapsWeek(group('EMP-001:PRJ-1:BE:2026-07-06:2026-08-07', 'EMP-001'), {
        weekId: 'W2',
        weekStart: '2026-07-06',
        weekEnd: '2026-07-12',
      }),
    ).toBe(true);
    expect(dateRangesOverlap('2026-08-01', '2026-08-31', '2026-07-06', '2026-07-12')).toBe(false);
  });
});
