import type { ColumnDef, VisibilityState } from '@tanstack/react-table';
import type {
  DemoMemberAnalysisRow,
  DemoMemberInput,
  DemoMemberWeekProjectRow,
  DemoMemberWeekRow,
  DemoProjectMemberDependencyRow,
} from '../../api/demo-analytics.ts';
import {
  excludedCell,
  hours,
  nullish,
  pct,
  projectStatusBadge,
  ragBadge,
  reasonBadge,
} from './formatters.tsx';
import { MetricHelpLabel } from './metric-help.tsx';
import { METRIC_HELP } from './metric-help-copy.ts';

/** Hidden until the user enables them in the table Columns menu. */
export const DEFAULT_PROJECT_METADATA_COLUMN_VISIBILITY: VisibilityState = {
  projectStartDate: false,
  projectEndDate: false,
  allocationStartDate: false,
  allocationEndDate: false,
};

function metricColumn(label: string, help: string) {
  return {
    header: () => <MetricHelpLabel help={help}>{label}</MetricHelpLabel>,
    meta: { label },
  };
}

function memberLabelCell(getMemberLabel: (memberId: string) => string) {
  return ({ row }: { row: { original: { memberId: string } } }) => {
    const { memberId } = row.original;
    const label = getMemberLabel(memberId);
    return (
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{label}</div>
        {label !== memberId ? <div className="text-caption text-ink-subtle">{memberId}</div> : null}
      </div>
    );
  };
}

function projectLabelCell(getProjectLabel: (projectId: string) => string) {
  return ({ row }: { row: { original: { projectId: string } } }) => (
    <span className="font-medium text-ink">{getProjectLabel(row.original.projectId)}</span>
  );
}

export const memberColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoMemberInput>[] => [
  { accessorKey: 'memberId', header: 'Member', cell: memberLabelCell(getMemberLabel) },
  { accessorKey: 'roleTitle', header: 'Role', cell: ({ row }) => nullish(row.original.roleTitle) },
  { accessorKey: 'stdHoursWeek', header: 'Std h/week' },
  { accessorKey: 'joinDate', header: 'Join date' },
];

export const projectMemberColumns = (
  getMemberLabel: (memberId: string) => string,
  getProjectLabel: (projectId: string) => string,
): ColumnDef<DemoProjectMemberDependencyRow>[] => [
  { accessorKey: 'memberId', header: 'Member', cell: memberLabelCell(getMemberLabel) },
  { accessorKey: 'projectId', header: 'Project', cell: projectLabelCell(getProjectLabel) },
  {
    accessorKey: 'pmId',
    header: 'PM',
    cell: ({ row }) => {
      const { pmId, pmName } = row.original;
      if (!pmId && !pmName) return <span className="text-ink-subtle">—</span>;
      return (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{pmName ?? pmId ?? '—'}</div>
          {pmId ? <div className="text-caption text-ink-subtle">{pmId}</div> : null}
        </div>
      );
    },
  },
  {
    accessorKey: 'memberRoleTitle',
    header: 'Member role',
    cell: ({ row }) => nullish(row.original.memberRoleTitle),
  },
  {
    accessorKey: 'allocationRole',
    header: 'RA role',
    cell: ({ row }) => nullish(row.original.allocationRole),
  },
  {
    accessorKey: 'projectStatus',
    header: 'Project status',
    cell: ({ row }) => projectStatusBadge(row.original.projectStatus),
  },
  {
    accessorKey: 'projectStartDate',
    header: 'Project start',
    cell: ({ row }) => nullish(row.original.projectStartDate),
  },
  {
    accessorKey: 'projectEndDate',
    header: 'Project end',
    cell: ({ row }) => nullish(row.original.projectEndDate),
  },
  {
    accessorKey: 'allocationStartDate',
    header: 'RA start',
    cell: ({ row }) => nullish(row.original.allocationStartDate),
  },
  {
    accessorKey: 'allocationEndDate',
    header: 'RA end',
    cell: ({ row }) => nullish(row.original.allocationEndDate),
  },
  {
    accessorKey: 'weeklyPlannedHours',
    header: 'Plan h/wk',
    cell: ({ row }) => (
      <span className="tabular-nums">{hours(row.original.weeklyPlannedHours)}</span>
    ),
  },
  {
    accessorKey: 'capacityShare',
    header: 'Cap. share',
    cell: ({ row }) => <span className="tabular-nums">{pct(row.original.capacityShare)}</span>,
  },
  {
    accessorKey: 'plannedHoursInWindow',
    header: 'Planned (window)',
    cell: ({ row }) => (
      <span className="tabular-nums">{hours(row.original.plannedHoursInWindow)}</span>
    ),
  },
  {
    accessorKey: 'loggedHours',
    header: 'Logged (window)',
    cell: ({ row }) => <span className="tabular-nums">{hours(row.original.loggedHours)}</span>,
  },
  {
    accessorKey: 'effortConsumption',
    header: 'EC',
    cell: ({ row }) => <span className="tabular-nums">{pct(row.original.effortConsumption)}</span>,
  },
];

export const memberWeekProjectColumns = (
  getMemberLabel: (memberId: string) => string,
  getProjectLabel: (projectId: string) => string,
): ColumnDef<DemoMemberWeekProjectRow>[] => [
  { accessorKey: 'memberId', header: 'Member', cell: memberLabelCell(getMemberLabel) },
  { accessorKey: 'weekId', header: 'Week' },
  { accessorKey: 'projectId', header: 'Project', cell: projectLabelCell(getProjectLabel) },
  {
    accessorKey: 'projectStatus',
    header: 'Status',
    cell: ({ row }) => projectStatusBadge(row.original.projectStatus),
  },
  {
    accessorKey: 'projectStartDate',
    header: 'Project start',
    cell: ({ row }) => nullish(row.original.projectStartDate),
  },
  {
    accessorKey: 'projectEndDate',
    header: 'Project end',
    cell: ({ row }) => nullish(row.original.projectEndDate),
  },
  {
    accessorKey: 'allocationStartDate',
    header: 'RA start',
    cell: ({ row }) => nullish(row.original.allocationStartDate),
  },
  {
    accessorKey: 'allocationEndDate',
    header: 'RA end',
    cell: ({ row }) => nullish(row.original.allocationEndDate),
  },
  {
    accessorKey: 'scopeStatus',
    ...metricColumn('Scope', METRIC_HELP.scope),
  },
  {
    accessorKey: 'suppressionReason',
    ...metricColumn('Reason', METRIC_HELP.reason),
    cell: ({ row }) => reasonBadge(row.original.suppressionReason),
  },
  {
    accessorKey: 'plannedHours',
    ...metricColumn('Planned', METRIC_HELP.planned),
    cell: ({ row }) => <span className="tabular-nums">{hours(row.original.plannedHours)}</span>,
  },
  {
    accessorKey: 'loggedHours',
    ...metricColumn('Logged', METRIC_HELP.logged),
    cell: ({ row }) => <span className="tabular-nums">{hours(row.original.loggedHours)}</span>,
  },
  {
    accessorKey: 'capacityShare',
    header: 'Cap. share',
    cell: ({ row }) => <span className="tabular-nums">{pct(row.original.capacityShare)}</span>,
  },
  {
    accessorKey: 'effortConsumption',
    ...metricColumn('EC', METRIC_HELP.effortConsumption),
    cell: ({ row }) => <span className="tabular-nums">{pct(row.original.effortConsumption)}</span>,
  },
];

export const factColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoMemberWeekRow>[] => [
  { accessorKey: 'memberId', header: 'Member', cell: memberLabelCell(getMemberLabel) },
  { accessorKey: 'weekId', header: 'Week' },
  {
    accessorKey: 'scopeStatus',
    ...metricColumn('Scope', METRIC_HELP.scope),
  },
  {
    accessorKey: 'suppressionReason',
    ...metricColumn('Reason', METRIC_HELP.reason),
    cell: ({ row }) => reasonBadge(row.original.suppressionReason),
  },
  {
    accessorKey: 'availableHours',
    ...metricColumn('Available', METRIC_HELP.available),
  },
  {
    accessorKey: 'plannedHours',
    ...metricColumn('Planned', METRIC_HELP.planned),
  },
  {
    accessorKey: 'loggedHours',
    ...metricColumn('Logged', METRIC_HELP.logged),
  },
  {
    accessorKey: 'expectedLoggedHours',
    ...metricColumn('Expected log', METRIC_HELP.expectedLogged),
  },
  {
    accessorKey: 'busyRate',
    ...metricColumn('Busy rate', METRIC_HELP.busyRate),
    cell: ({ row }) => pct(row.original.busyRate),
  },
  {
    accessorKey: 'effortConsumption',
    ...metricColumn('EC', METRIC_HELP.effortConsumption),
    cell: ({ row }) => pct(row.original.effortConsumption),
  },
  {
    accessorKey: 'ragColor',
    ...metricColumn('RAG', METRIC_HELP.rag),
    cell: ({ row }) => ragBadge(row.original.ragColor),
  },
  {
    accessorKey: 'issueType',
    ...metricColumn('Issue', METRIC_HELP.issue),
  },
];

export const analysisColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoMemberAnalysisRow>[] => [
  { accessorKey: 'memberId', header: 'Member', cell: memberLabelCell(getMemberLabel) },
  {
    accessorKey: 'inScopeWeekCount',
    ...metricColumn('In-scope weeks', METRIC_HELP.inScopeWeeks),
  },
  {
    accessorKey: 'busyRate',
    ...metricColumn('Busy rate', METRIC_HELP.busyRate),
    cell: ({ row }) => pct(row.original.busyRate),
  },
  {
    accessorKey: 'effortConsumption',
    ...metricColumn('EC', METRIC_HELP.effortConsumption),
    cell: ({ row }) => pct(row.original.effortConsumption),
  },
  {
    id: 'excluded',
    ...metricColumn('Excluded weeks', METRIC_HELP.excludedWeeks),
    cell: ({ row }) => excludedCell(row.original.excludedWeeks),
  },
];
