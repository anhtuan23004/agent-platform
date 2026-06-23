import { describe, expect, it } from 'vitest';
import {
  buildFindingsDonutSlices,
  buildMemberBusyRateRows,
  buildMemberDrilldownSummary,
  buildMemberProjectSplitRows,
  buildMemberWeekTimelineRows,
  buildProjectWorkloadRows,
  buildThresholdReferenceLines,
  buildWeekWorkloadRows,
  classifyMemberUtilizationBand,
  classifyMemberUtilizationOutcome,
  sortWorkloadRowsForDisplay,
  utilizationBandLabels,
} from '../../../src/modules/pmo/pages/demo-calculation/utilization-charts.logic.ts';

describe('utilization-charts.logic', () => {
  const thresholds = {
    overbookThreshold: 1.1,
    overbookRedThreshold: 1.2,
    idleThreshold: 0.75,
    idleYellowThreshold: 0.85,
    mismatchPctThreshold: 0.2,
    otMaxHoursPerWeek: 10,
    requiredTrainingHours: 0,
  };

  it('classifies busy rate bands', () => {
    expect(classifyMemberUtilizationBand(1.25, thresholds)).toBe('overbook_red');
    expect(classifyMemberUtilizationBand(1.15, thresholds)).toBe('overbook_warn');
    expect(classifyMemberUtilizationBand(0.6, thresholds)).toBe('idle_red');
    expect(classifyMemberUtilizationBand(0.8, thresholds)).toBe('idle_warn');
    expect(classifyMemberUtilizationBand(1, thresholds)).toBe('ok');
  });

  it('builds member bar rows as percentages', () => {
    const rows = buildMemberBusyRateRows(
      [
        {
          memberId: 'EMP-002',
          inScopeWeekCount: 2,
          busyRate: 0.6,
          effortConsumption: 1,
          excludedWeeks: [],
        },
        {
          memberId: 'EMP-001',
          inScopeWeekCount: 2,
          busyRate: 1.2,
          effortConsumption: 1,
          excludedWeeks: [],
        },
      ],
      thresholds,
      (id) => id,
    );
    expect(rows.map((row) => row.key)).toEqual(['EMP-001', 'EMP-002']);
    expect(rows[0]?.value).toBe(120);
    expect(rows[1]?.value).toBe(60);
  });

  it('prioritizes notable workload rows before healthy rows', () => {
    const sorted = sortWorkloadRowsForDisplay(
      [
        { key: 'ok-1', label: 'Healthy A', value: 100, color: 'green' },
        { key: 'idle-1', label: 'Idle A', value: 60, color: 'red' },
        { key: 'ob-1', label: 'Overbook A', value: 125, color: 'red' },
        { key: 'ok-2', label: 'Healthy B', value: 95, color: 'green' },
      ],
      thresholds,
    );
    expect(sorted.map((row) => row.key)).toEqual(['ob-1', 'idle-1', 'ok-1', 'ok-2']);
  });

  it('maps thresholds to reference line percentages', () => {
    const lines = buildThresholdReferenceLines(thresholds);
    expect(lines.map((line) => line.value)).toEqual([75, 85, 110, 120]);
  });

  it('classifies mismatch after busy-rate bands', () => {
    expect(classifyMemberUtilizationOutcome(1, 0.5, thresholds)).toBe('mismatch_under');
    expect(classifyMemberUtilizationOutcome(1, 1.5, thresholds)).toBe('mismatch_over');
    expect(classifyMemberUtilizationOutcome(1.2, 0.5, thresholds)).toBe('overbook');
    expect(classifyMemberUtilizationOutcome(null, null, thresholds)).toBe('healthy');
  });

  it('labels donut bands with mismatch instead of no-plan', () => {
    const slices = buildFindingsDonutSlices(
      [
        {
          memberId: 'EMP-001',
          inScopeWeekCount: 1,
          busyRate: 1.2,
          effortConsumption: 1,
          excludedWeeks: [],
        },
        {
          memberId: 'EMP-002',
          inScopeWeekCount: 1,
          busyRate: 0.6,
          effortConsumption: 1,
          excludedWeeks: [],
        },
        {
          memberId: 'EMP-003',
          inScopeWeekCount: 1,
          busyRate: 1,
          effortConsumption: 1,
          excludedWeeks: [],
        },
        {
          memberId: 'EMP-004',
          inScopeWeekCount: 1,
          busyRate: 1,
          effortConsumption: 0.5,
          excludedWeeks: [],
        },
        {
          memberId: 'EMP-005',
          inScopeWeekCount: 1,
          busyRate: null,
          effortConsumption: null,
          excludedWeeks: [],
        },
      ],
      thresholds,
    );
    expect(slices.map((slice) => slice.name)).toEqual(['Overbook', 'Idle', 'Healthy', 'Mismatch']);
    expect(slices.find((slice) => slice.key === 'healthy')?.value).toBe(2);
    expect(utilizationBandLabels().mismatch).toBe('Mismatch');
  });

  it('aggregates project and week workload rows', () => {
    const data = {
      thresholds,
      projectMemberDependencies: [
        {
          projectId: 'PRJ-1',
          projectName: 'Alpha',
          pmId: null,
          pmName: null,
          memberId: 'EMP-001',
          memberName: 'A',
          memberRoleTitle: null,
          allocationRole: null,
          weeklyPlannedHours: 40,
          plannedHoursInWindow: 240,
          loggedHours: 240,
          capacityShare: 1,
          effortConsumption: 1,
          allocationStartDate: '2026-06-29',
          allocationEndDate: '2026-08-07',
          projectStartDate: '2026-01-01',
          projectEndDate: '2026-12-31',
          projectStatus: 'Active',
        },
        {
          projectId: 'PRJ-2',
          projectName: 'Beta',
          pmId: null,
          pmName: null,
          memberId: 'EMP-002',
          memberName: 'B',
          memberRoleTitle: null,
          allocationRole: null,
          weeklyPlannedHours: 20,
          plannedHoursInWindow: 120,
          loggedHours: 120,
          capacityShare: 0.5,
          effortConsumption: 1,
          allocationStartDate: '2026-06-29',
          allocationEndDate: '2026-08-07',
          projectStartDate: '2026-01-01',
          projectEndDate: '2026-12-31',
        },
      ],
      memberWeekFacts: [
        {
          memberId: 'EMP-001',
          weekId: 'W1',
          scopeStatus: 'IN_SCOPE',
          plannedHours: 48,
          availableHours: 40,
          loggedHours: 48,
          expectedLoggedHours: 48,
          busyRate: 1.2,
          effortConsumption: 1,
          ragColor: 'red',
          issueType: 'overbook',
          suppressionReason: null,
        },
        {
          memberId: 'EMP-002',
          weekId: 'W1',
          scopeStatus: 'IN_SCOPE',
          plannedHours: 20,
          availableHours: 40,
          loggedHours: 20,
          expectedLoggedHours: 20,
          busyRate: 0.5,
          effortConsumption: 1,
          ragColor: 'red',
          issueType: 'idle',
          suppressionReason: null,
        },
      ],
    } as never;

    const projects = buildProjectWorkloadRows(data, thresholds, (id) => id);
    expect(projects).toHaveLength(2);
    expect(projects.find((row) => row.key === 'PRJ-1')?.value).toBe(120);

    const weeks = buildWeekWorkloadRows(data, thresholds);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.value).toBe(85);
  });

  it('builds member drill-down summary and project split rows', () => {
    const data = {
      thresholds,
      canonical: {
        members: [
          {
            memberId: 'EMP-004',
            fullName: 'Pham Thi Dung',
            roleTitle: 'Developer',
            stdHoursWeek: 40,
            joinDate: '2024-01-01',
          },
        ],
      },
      populations: { deliveryMembers: [], projectManagers: [] },
      overbookIdleFindings: [
        {
          memberId: 'EMP-004',
          issueType: 'overbook_red',
          ragColor: 'red',
          busyRate: 1.25,
          effortConsumption: 0.98,
          detail: 'Assigned 125% of capacity.',
          excludedWeeks: [{ weekId: 'W0', reason: 'holiday_week' }],
        },
      ],
      mismatchFindings: [],
      memberAnalyses: [
        {
          memberId: 'EMP-004',
          inScopeWeekCount: 6,
          busyRate: 1.25,
          effortConsumption: 0.98,
          excludedWeeks: [{ weekId: 'W0', reason: 'holiday_week' }],
        },
      ],
      memberWeekFacts: [
        {
          memberId: 'EMP-004',
          weekId: 'W1',
          scopeStatus: 'IN_SCOPE',
          plannedHours: 50,
          availableHours: 40,
          loggedHours: 49,
          expectedLoggedHours: 50,
          busyRate: 1.25,
          effortConsumption: 0.98,
          ragColor: 'red',
          issueType: 'overbook',
          suppressionReason: null,
        },
      ],
      projectMemberDependencies: [
        {
          projectId: 'PRJ-1',
          projectName: 'Alpha',
          pmId: null,
          pmName: null,
          memberId: 'EMP-004',
          memberName: 'Pham Thi Dung',
          memberRoleTitle: 'Developer',
          allocationRole: 'Dev',
          weeklyPlannedHours: 30,
          plannedHoursInWindow: 180,
          loggedHours: 176,
          capacityShare: 0.75,
          effortConsumption: 0.98,
          allocationStartDate: '2026-06-29',
          allocationEndDate: '2026-08-07',
          projectStartDate: '2026-01-01',
          projectEndDate: '2026-12-31',
          projectStatus: 'Active',
        },
        {
          projectId: 'PRJ-2',
          projectName: 'Beta',
          pmId: null,
          pmName: null,
          memberId: 'EMP-004',
          memberName: 'Pham Thi Dung',
          memberRoleTitle: 'Developer',
          allocationRole: 'Dev',
          weeklyPlannedHours: 20,
          plannedHoursInWindow: 120,
          loggedHours: 118,
          capacityShare: 0.5,
          effortConsumption: 0.98,
          allocationStartDate: '2026-06-29',
          allocationEndDate: '2026-08-07',
          projectStartDate: '2026-01-01',
          projectEndDate: '2026-12-31',
          projectStatus: 'Active',
        },
      ],
    } as never;

    const summary = buildMemberDrilldownSummary(data, 'EMP-004', (id) => id);
    expect(summary).toMatchObject({
      memberId: 'EMP-004',
      roleTitle: 'Developer',
      stdHoursWeek: 40,
      issueType: 'overbook_red',
      plannedHours: 50,
      availableHours: 40,
      loggedHours: 49,
      inScopeWeekCount: 6,
      detail: 'Assigned 125% of capacity.',
    });

    const projects = buildMemberProjectSplitRows(data, 'EMP-004', thresholds, (id) => id);
    expect(projects.map((row) => row.key)).toEqual(['PRJ-1', 'PRJ-2']);
    expect(projects[0]?.value).toBe(75);
    expect(projects[1]?.value).toBe(50);

    const timeline = buildMemberWeekTimelineRows(data, 'EMP-004');
    expect(timeline).toEqual([{ label: 'W1', busyRate: 125, effortConsumption: 98 }]);
  });
});
