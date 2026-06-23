import {
  ChartCard,
  DonutChart,
  SegmentedControl,
  SeriesLineChart,
  WorkloadBarList,
} from '@seta/shared-ui';
import { useMemo, useState } from 'react';
import type { DemoAnalyticsResult } from '../../api/demo-analytics.ts';
import { MemberDrilldownCard } from './member-drilldown-card.tsx';
import {
  buildFindingsDonutSlices,
  buildMemberBusyRateRows,
  buildMemberDrilldownSummary,
  buildMemberProjectSplitRows,
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
  const showMemberDrilldown = workloadView === 'member' && selectedMemberId;

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

  const memberDrilldown = useMemo(
    () =>
      selectedMemberId ? buildMemberDrilldownSummary(data, selectedMemberId, getMemberLabel) : null,
    [data, selectedMemberId, getMemberLabel],
  );

  const memberProjectRows = useMemo(
    () =>
      selectedMemberId
        ? buildMemberProjectSplitRows(data, selectedMemberId, data.thresholds, getProjectLabel)
        : [],
    [data, selectedMemberId, getProjectLabel],
  );

  const donutSlices = useMemo(() => {
    if (workloadView === 'member') {
      return buildFindingsDonutSlices(data.memberAnalyses, data.thresholds);
    }
    const metrics =
      workloadView === 'project'
        ? buildProjectWorkloadMetrics(data)
        : buildWeekWorkloadMetrics(data);
    return buildWorkloadDonutSlices(workloadRows, data.thresholds, metrics);
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
        ...(showMemberDrilldown ? memberProjectRows : workloadRows).map((row) => row.value),
        100,
      ),
    [data.thresholds.overbookRedThreshold, showMemberDrilldown, memberProjectRows, workloadRows],
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
        {showMemberDrilldown && memberDrilldown ? (
          <ChartCard
            title="Member overview"
            subtitle="Busy rate, effort consumption, and hour totals for the selected member."
            testId="chart-member-drilldown"
            action={
              <button
                type="button"
                className="text-caption text-primary hover:underline"
                onClick={() => onSelectMember(null)}
              >
                Clear selection
              </button>
            }
          >
            <MemberDrilldownCard summary={memberDrilldown} />
          </ChartCard>
        ) : (
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
        )}

        <ChartCard
          title={showMemberDrilldown ? 'Workload by project' : workloadCopy.title}
          subtitle={
            showMemberDrilldown
              ? 'Capacity share per active project assignment for this member.'
              : workloadCopy.subtitle
          }
          testId="chart-busy-rate-members"
        >
          <WorkloadBarList
            key={showMemberDrilldown ? `member-projects-${selectedMemberId}` : workloadView}
            rows={(showMemberDrilldown ? memberProjectRows : workloadRows).map((row) => ({
              key: row.key,
              label: row.label,
              value: row.value,
              color: row.color,
            }))}
            scaleMax={barScaleMax}
            maxVisible={WORKLOAD_LIST_MAX_VISIBLE}
            assigneeColumnLabel={showMemberDrilldown ? 'Project' : workloadCopy.assignee}
            distributionColumnLabel={
              showMemberDrilldown ? 'Capacity share' : workloadCopy.distribution
            }
            selectedKey={
              !showMemberDrilldown && workloadView === 'member' ? selectedMemberId : null
            }
            onRowClick={
              !showMemberDrilldown && workloadView === 'member'
                ? (row) => onSelectMember(selectedMemberId === row.key ? null : row.key)
                : undefined
            }
            emptyMessage={
              showMemberDrilldown
                ? 'No project assignments for this member in the reporting window.'
                : `No ${workloadCopy.assignee.toLowerCase()} busy rates in this reporting window.`
            }
          />
        </ChartCard>
      </div>

      {showMemberDrilldown ? (
        <ChartCard
          title={`Weekly trend — ${getMemberLabel(selectedMemberId)}`}
          subtitle="Busy rate and effort consumption by in-scope week."
          testId="chart-member-week-timeline"
        >
          <SeriesLineChart
            rows={memberTimelineRows}
            series={[
              { key: 'busyRate', name: 'Busy rate', color: 'var(--color-primary)' },
              {
                key: 'effortConsumption',
                name: 'Effort consumption',
                color: 'var(--color-warning)',
              },
            ]}
            referenceLines={referenceLines}
            valueFormatter={pctLabel}
          />
        </ChartCard>
      ) : null}
    </section>
  );
}
