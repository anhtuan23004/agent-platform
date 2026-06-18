import type { ColumnDef } from '@tanstack/react-table';
import type {
  DemoMemberAnalysisRow,
  DemoMemberInput,
  DemoMemberWeekRow,
  DemoProjectMemberDependencyRow,
} from '../../api/demo-analytics.ts';
import { excludedCell, nullish, pct, ragBadge, reasonBadge } from './formatters.tsx';

function memberLabelCell(getMemberLabel: (memberId: string) => string) {
  return ({ row }: { row: { original: { memberId: string } } }) => (
    <span className="font-medium text-ink">{getMemberLabel(row.original.memberId)}</span>
  );
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
  { accessorKey: 'fullName', header: 'Name', cell: ({ row }) => nullish(row.original.fullName) },
  { accessorKey: 'roleTitle', header: 'Role', cell: ({ row }) => nullish(row.original.roleTitle) },
  { accessorKey: 'stdHoursWeek', header: 'Std h/week' },
  { accessorKey: 'joinDate', header: 'Join date' },
];

export const projectMemberColumns = (
  getMemberLabel: (memberId: string) => string,
  getProjectLabel: (projectId: string) => string,
): ColumnDef<DemoProjectMemberDependencyRow>[] => [
  { accessorKey: 'projectId', header: 'Project', cell: projectLabelCell(getProjectLabel) },
  {
    accessorKey: 'pmId',
    header: 'PM',
    cell: ({ row }) => {
      const pm = row.original.pmId;
      if (!pm) return <span className="text-ink-subtle">—</span>;
      return <span className="font-medium text-ink">{pm}</span>;
    },
  },
  { accessorKey: 'memberId', header: 'Delivery member', cell: memberLabelCell(getMemberLabel) },
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
  { accessorKey: 'weeklyPlannedHours', header: 'Planned h/week' },
];

export const factColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoMemberWeekRow>[] => [
  {
    accessorKey: 'memberId',
    header: 'Member',
    cell: ({ row }) => (
      <span className="font-medium text-ink">{getMemberLabel(row.original.memberId)}</span>
    ),
  },
  { accessorKey: 'weekId', header: 'Week' },
  { accessorKey: 'scopeStatus', header: 'Scope' },
  {
    accessorKey: 'suppressionReason',
    header: 'Reason',
    cell: ({ row }) => reasonBadge(row.original.suppressionReason),
  },
  { accessorKey: 'availableHours', header: 'Available' },
  { accessorKey: 'plannedHours', header: 'Planned' },
  { accessorKey: 'loggedHours', header: 'Logged' },
  { accessorKey: 'expectedLoggedHours', header: 'Expected log' },
  {
    accessorKey: 'busyRate',
    header: 'Busy rate',
    cell: ({ row }) => pct(row.original.busyRate),
  },
  {
    accessorKey: 'effortConsumption',
    header: 'EC',
    cell: ({ row }) => pct(row.original.effortConsumption),
  },
  {
    accessorKey: 'ragColor',
    header: 'RAG',
    cell: ({ row }) => ragBadge(row.original.ragColor),
  },
  { accessorKey: 'issueType', header: 'Issue' },
];

export const analysisColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoMemberAnalysisRow>[] => [
  {
    accessorKey: 'memberId',
    header: 'Member',
    cell: ({ row }) => (
      <span className="font-medium text-ink">{getMemberLabel(row.original.memberId)}</span>
    ),
  },
  { accessorKey: 'inScopeWeekCount', header: 'In-scope weeks' },
  {
    accessorKey: 'busyRate',
    header: 'Busy rate',
    cell: ({ row }) => pct(row.original.busyRate),
  },
  {
    accessorKey: 'effortConsumption',
    header: 'EC',
    cell: ({ row }) => pct(row.original.effortConsumption),
  },
  {
    id: 'excluded',
    header: 'Excluded weeks',
    cell: ({ row }) => excludedCell(row.original.excludedWeeks),
  },
];
