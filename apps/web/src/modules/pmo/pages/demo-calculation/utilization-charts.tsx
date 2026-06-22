import {
  ChartCard,
  DonutChart,
  SegmentedControl,
  SeriesLineChart,
  WorkloadBarList,
} from '@seta/shared-ui';
import { useMemo, useState } from 'react';
import type { DemoAnalyticsResult } from '../../api/demo-analytics.ts';
import {
  buildFindingsDonutSlices,
  buildMemberBusyRateRows,
  buildMemberWeekTimelineRows,
  buildProjectWorkloadMetrics,
  buildProjectWorkloadRows,
  buildThresholdReferenceLines,
  buildWeekWorkloadMetrics,
  buildWeekWorkloadRows,
  buildWorkloadDonutSlices,
  sortWorkloadRowsForDisplay,
  type UtilizationWorkloadView,
} from './utilization-charts.logic.ts';

const WORKLOAD_LIST_MAX_VISIBLE = 10;

export interface UtilizationChartsProps {
  data: DemoAnalyticsResult;
  getMemberLabel: (memberId: string) => string;
  getProjectLabel: (projectId: string) => string;
  projectFilter: string | null;
  selectedMemberId: string | null;
  onSelectMember: (memberId: string | null) => void;
  onScrollToFindings?: () => void;
}

const WORKLOAD_VIEW_OPTIONS = [
  { value: 'member' as const, label: 'Member' },
  { value: 'project' as const, label: 'Project' },
  { value: 'week' as const, label: 'Week' },
];

function pctLabel(value: number): string {
  return `${value}%`;
}

export function UtilizationCharts({
  data,
  getMemberLabel,
  getProjectLabel,
  projectFilter,
  selectedMemberId,
  onSelectMember,
  onScrollToFindings,
}: UtilizationChartsProps) {
  const [workloadView, setWorkloadView] = useState<UtilizationWorkloadView>('member');

  const memberRows = useMemo(
    () => buildMemberBusyRateRows(data.memberAnalyses, data.thresholds, getMemberLabel),
    [data.memberAnalyses, data.thresholds, getMemberLabel],
  );
  const projectRows = useMemo(
    () => buildProjectWorkloadRows(data, data.thresholds, getProjectLabel),
    [data, getProjectLabel],
  );
  const weekRows = useMemo(() => buildWeekWorkloadRows(data, data.thresholds), [data]);

  const effortByMember = useMemo(
    () =>
      new Map(
        data.memberAnalyses.map((analysis) => [analysis.memberId, analysis.effortConsumption]),
      ),
    [data.memberAnalyses],
  );

  const workloadRows = useMemo(() => {
    const rows =
      workloadView === 'project' ? projectRows : workloadView === 'week' ? weekRows : memberRows;
    return sortWorkloadRowsForDisplay(
      rows,
      data.thresholds,
      workloadView === 'member' ? effortByMember : undefined,
    );
  }, [workloadView, memberRows, projectRows, weekRows, data.thresholds, effortByMember]);

  const donutSlices = useMemo(() => {
    if (workloadView === 'member') {
      return buildFindingsDonutSlices(data.memberAnalyses, data.thresholds, workloadView);
    }
    const metrics =
      workloadView === 'project'
        ? buildProjectWorkloadMetrics(data)
        : buildWeekWorkloadMetrics(data);
    return buildWorkloadDonutSlices(workloadRows, data.thresholds, workloadView, metrics);
  }, [workloadView, data, workloadRows]);

  const overviewCenter = useMemo(() => {
    if (workloadView === 'member')
      return { value: data.memberAnalyses.length, label: 'Total members' };
    if (workloadView === 'project') return { value: projectRows.length, label: 'Projects' };
    return { value: weekRows.length, label: 'Weeks' };
  }, [workloadView, data.memberAnalyses.length, projectRows.length, weekRows.length]);

  const referenceLines = useMemo(
    () => buildThresholdReferenceLines(data.thresholds),
    [data.thresholds],
  );
  const memberTimelineRows = useMemo(
    () => (selectedMemberId ? buildMemberWeekTimelineRows(data, selectedMemberId) : []),
    [data, selectedMemberId],
  );
  const barScaleMax = useMemo(
    () =>
      Math.max(
        Math.ceil(data.thresholds.overbookRedThreshold * 100),
        ...workloadRows.map((row) => row.value),
        100,
      ),
    [data.thresholds.overbookRedThreshold, workloadRows],
  );

  const workloadCopy = useMemo(() => {
    if (workloadView === 'project') {
      return {
        title: 'Workload by project',
        subtitle:
          'Team busy rate rolled up per delivery project (sum planned ÷ sum available for roster members).',
        assignee: 'Project',
        distribution: 'Team busy rate',
      };
    }
    if (workloadView === 'week') {
      return {
        title: 'Workload by week',
        subtitle: 'Team busy rate per calendar week across all delivery members in scope.',
        assignee: 'Week',
        distribution: 'Team busy rate',
      };
    }
    return {
      title: 'Team workload distribution',
      subtitle: 'Busy rate by member for the selected period.',
      assignee: 'Member',
      distribution: 'Busy rate',
    };
  }, [workloadView]);

  const handleViewChange = (next: UtilizationWorkloadView) => {
    setWorkloadView(next);
    if (next !== 'member') onSelectMember(null);
  };

  return (
    <section className="space-y-4" data-testid="utilization-charts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Utilization chart dimension"
          value={workloadView}
          onValueChange={handleViewChange}
          options={WORKLOAD_VIEW_OPTIONS}
          size="md"
        />
        {projectFilter ? (
          <p className="text-caption text-ink-subtle">
            Filtered to project{' '}
            <span className="font-medium text-ink">{getProjectLabel(projectFilter)}</span>
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Utilization overview"
          subtitle={
            <>
              {workloadView === 'member'
                ? 'Snapshot of member busy-rate bands.'
                : workloadView === 'project'
                  ? 'How many projects sit in each busy-rate band.'
                  : 'How many weeks sit in each busy-rate band.'}{' '}
              {onScrollToFindings ? (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={onScrollToFindings}
                >
                  View all findings
                </button>
              ) : null}
            </>
          }
          testId="chart-utilization-mix"
        >
          <DonutChart
            slices={donutSlices}
            centerValue={overviewCenter.value}
            centerLabel={overviewCenter.label}
            legend="right"
            legendStyle="detailed"
            height={200}
          />
        </ChartCard>

        <ChartCard
          title={workloadCopy.title}
          subtitle={workloadCopy.subtitle}
          testId="chart-busy-rate-members"
          action={
            workloadView === 'member' && selectedMemberId ? (
              <button
                type="button"
                className="text-caption text-primary hover:underline"
                onClick={() => onSelectMember(null)}
              >
                Clear selection
              </button>
            ) : null
          }
        >
          <WorkloadBarList
            key={workloadView}
            rows={workloadRows.map((row) => ({
              key: row.key,
              label: row.label,
              value: row.value,
              color: row.color,
            }))}
            scaleMax={barScaleMax}
            maxVisible={WORKLOAD_LIST_MAX_VISIBLE}
            assigneeColumnLabel={workloadCopy.assignee}
            distributionColumnLabel={workloadCopy.distribution}
            selectedKey={workloadView === 'member' ? selectedMemberId : null}
            onRowClick={
              workloadView === 'member'
                ? (row) => onSelectMember(selectedMemberId === row.key ? null : row.key)
                : undefined
            }
            emptyMessage={`No ${workloadCopy.assignee.toLowerCase()} busy rates in this reporting window.`}
          />
        </ChartCard>
      </div>

      {workloadView === 'member' && selectedMemberId ? (
        <ChartCard
          title={`Weekly busy rate — ${getMemberLabel(selectedMemberId)}`}
          subtitle="Member × week trend for in-scope weeks"
          testId="chart-member-week-timeline"
        >
          <SeriesLineChart
            rows={memberTimelineRows}
            series={[{ key: 'busyRate', name: 'Busy rate', color: 'var(--color-primary)' }]}
            referenceLines={referenceLines}
            valueFormatter={pctLabel}
          />
        </ChartCard>
      ) : null}
    </section>
  );
}
