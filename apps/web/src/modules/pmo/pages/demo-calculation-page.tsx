import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DataTable,
  EmptyState,
  PageChrome,
  PageChromeToolbar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@seta/shared-ui';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, ChevronDown, Database, Filter, X, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type {
  DemoAllocationInput,
  DemoAnswerKeyRow,
  DemoFindingRow,
  DemoLeaveInput,
  DemoMemberAnalysisRow,
  DemoMemberInput,
  DemoMemberWeekRow,
  DemoProjectInput,
  DemoProjectMemberDependencyRow,
  DemoTimesheetInput,
  DemoWeekInput,
} from '../api/demo-analytics.ts';
import { useDemoAnalytics } from '../hooks/use-demo-analytics.ts';

function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function ragBadge(color: string) {
  const variant =
    color === 'red'
      ? 'destructive'
      : color === 'yellow'
        ? 'warning'
        : color === 'green'
          ? 'success'
          : 'secondary';
  return <Badge variant={variant}>{color}</Badge>;
}

function reasonBadge(reason: string | null) {
  if (!reason) return <span className="text-ink-subtle">—</span>;
  const label =
    reason === 'no_plan'
      ? 'Unassigned (no plan)'
      : reason === 'pre_hire'
        ? 'Pre-hire'
        : reason === 'holiday_week'
          ? 'Holiday week'
          : reason === 'approved_leave'
            ? 'Approved leave'
            : reason === 'approved_ot'
              ? 'Approved OT'
              : reason === 'training'
                ? 'Training'
                : reason;
  const variant =
    reason === 'no_plan' || reason === 'pre_hire'
      ? 'secondary'
      : reason === 'holiday_week'
        ? 'outline'
        : 'warning';
  return <Badge variant={variant}>{label}</Badge>;
}

function excludedCell(weeks: Array<{ weekId: string; reason: string }>) {
  return weeks.length > 0 ? weeks.map((w) => `${w.weekId} (${w.reason})`).join(', ') : '—';
}

function nullish(v: string | null | undefined): ReactNode {
  return v == null || v === '' ? <span className="text-ink-subtle">—</span> : v;
}

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

const memberColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoMemberInput>[] => [
  { accessorKey: 'memberId', header: 'Member', cell: memberLabelCell(getMemberLabel) },
  { accessorKey: 'fullName', header: 'Name', cell: ({ row }) => nullish(row.original.fullName) },
  { accessorKey: 'roleTitle', header: 'Role', cell: ({ row }) => nullish(row.original.roleTitle) },
  { accessorKey: 'stdHoursWeek', header: 'Std h/week' },
  { accessorKey: 'joinDate', header: 'Join date' },
];

const projectColumns: ColumnDef<DemoProjectInput>[] = [
  { accessorKey: 'projectId', header: 'Project' },
  { accessorKey: 'projectName', header: 'Name' },
  {
    accessorKey: 'accountId',
    header: 'Account',
    cell: ({ row }) => nullish(row.original.accountId),
  },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => nullish(row.original.status) },
  {
    accessorKey: 'projectType',
    header: 'Type',
    cell: ({ row }) => nullish(row.original.projectType),
  },
  {
    accessorKey: 'pmId',
    header: 'PM',
    cell: ({ row }) => {
      const pm = row.original.pmId;
      if (!pm) return <span className="text-ink-subtle">—</span>;
      return <span className="font-medium text-ink">{pm}</span>;
    },
  },
  { accessorKey: 'startDate', header: 'Start', cell: ({ row }) => nullish(row.original.startDate) },
  { accessorKey: 'endDate', header: 'End', cell: ({ row }) => nullish(row.original.endDate) },
];

const allocationColumns = (
  getMemberLabel: (memberId: string) => string,
  getProjectLabel: (projectId: string) => string,
  getProjectPm: (projectId: string) => string | null,
): ColumnDef<DemoAllocationInput>[] => [
  { accessorKey: 'memberId', header: 'Member', cell: memberLabelCell(getMemberLabel) },
  { accessorKey: 'projectId', header: 'Project', cell: projectLabelCell(getProjectLabel) },
  { accessorKey: 'role', header: 'Role', cell: ({ row }) => nullish(row.original.role) },
  {
    id: 'pm',
    header: 'PM',
    cell: ({ row }) => {
      const pm = getProjectPm(row.original.projectId);
      if (!pm) return <span className="text-ink-subtle">—</span>;
      return <span className="font-medium text-ink">{pm}</span>;
    },
  },
  { accessorKey: 'weeklyPlannedHours', header: 'Planned h/week' },
  { accessorKey: 'startDate', header: 'Start' },
  { accessorKey: 'endDate', header: 'End' },
];

const projectMemberColumns = (
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

const timesheetColumns: ColumnDef<DemoTimesheetInput>[] = [
  { accessorKey: 'memberId', header: 'Member' },
  { accessorKey: 'workDate', header: 'Work date' },
  { accessorKey: 'loggedHours', header: 'Logged h' },
  { accessorKey: 'logCategory', header: 'Category' },
];

const leaveColumns: ColumnDef<DemoLeaveInput>[] = [
  { accessorKey: 'memberId', header: 'Member' },
  { accessorKey: 'leaveDate', header: 'Date' },
  { accessorKey: 'leaveType', header: 'Type' },
  {
    accessorKey: 'approved',
    header: 'Approved',
    cell: ({ row }) =>
      row.original.approved === true ? 'yes' : row.original.approved === false ? 'no' : '—',
  },
  { accessorKey: 'durationDays', header: 'Days' },
];

const weekColumns: ColumnDef<DemoWeekInput>[] = [
  { accessorKey: 'weekId', header: 'Week' },
  { accessorKey: 'weekStart', header: 'Start' },
  { accessorKey: 'weekEnd', header: 'End' },
  { accessorKey: 'workingDays', header: 'Working days' },
  { accessorKey: 'holidayHoursFt', header: 'Holiday h (FT)' },
];

const factColumns = (
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

const analysisColumns = (
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

const findingColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoFindingRow>[] => [
  {
    accessorKey: 'memberId',
    header: 'Member',
    cell: ({ row }) => (
      <span className="font-medium text-ink">{getMemberLabel(row.original.memberId)}</span>
    ),
  },
  { accessorKey: 'issueType', header: 'Issue' },
  {
    accessorKey: 'ragColor',
    header: 'RAG',
    cell: ({ row }) => ragBadge(row.original.ragColor),
  },
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
  { accessorKey: 'detail', header: 'Detail' },
  {
    id: 'excluded',
    header: 'Excluded weeks',
    cell: ({ row }) => excludedCell(row.original.excludedWeeks),
  },
];

const answerKeyColumns = (
  getMemberLabel: (memberId: string) => string,
): ColumnDef<DemoAnswerKeyRow>[] => [
  {
    accessorKey: 'memberId',
    header: 'Member',
    cell: ({ row }) => (
      <span className="font-medium text-ink">{getMemberLabel(row.original.memberId)}</span>
    ),
  },
  { accessorKey: 'expected', header: 'Expected' },
  { accessorKey: 'actual', header: 'Actual' },
  {
    id: 'match',
    header: 'Match',
    cell: ({ row }) =>
      row.original.match ? (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="size-4" />
          pass
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-danger">
          <XCircle className="size-4" />
          fail
        </span>
      ),
  },
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

function StagePanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-body font-medium text-ink">{title}</h3>
        <p className="text-body-sm text-ink-subtle">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function DemoCalculationPage() {
  const { data, isLoading, isError, error } = useDemoAnalytics();
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [projectFilterOpen, setProjectFilterOpen] = useState(false);

  const thresholdSummary = useMemo(() => {
    if (!data) return null;
    const t = data.thresholds;
    return [
      { label: 'Overbook (yellow)', value: pct(t.overbookThreshold) },
      { label: 'Overbook (red)', value: pct(t.overbookRedThreshold) },
      { label: 'Idle', value: pct(t.idleThreshold) },
      { label: 'Mismatch', value: pct(t.mismatchPctThreshold) },
    ];
  }, [data]);

  const noData = isError && error instanceof Error && error.message.includes('No PMO canonical');

  const members = useMemo(() => {
    const rows = data?.canonical.members ?? [];
    return [...new Set(rows.map((m) => m.memberId))].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const projects = useMemo(() => {
    const rows = data?.canonical.projects ?? [];
    return [...new Set(rows.map((p) => p.projectId))].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const memberLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of data?.canonical.members ?? []) {
      map.set(m.memberId, m.memberId);
    }
    return map;
  }, [data]);

  const projectLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of data?.canonical.projects ?? []) {
      map.set(p.projectId, p.projectId);
    }
    return map;
  }, [data]);

  const projectById = useMemo(() => {
    const map = new Map<string, DemoProjectInput>();
    for (const p of data?.canonical.projects ?? []) map.set(p.projectId, p);
    return map;
  }, [data]);

  const getMemberLabel = (id: string) => memberLabelById.get(id) ?? id;
  const getProjectLabel = (id: string) => projectLabelById.get(id) ?? id;
  const getProjectPm = (projectId: string) => projectById.get(projectId)?.pmId ?? null;

  const filtered = useMemo(() => {
    if (!data) return null;
    const onlyProject = (id: string) => (projectFilter ? id === projectFilter : true);
    const projectDependencyRows = projectFilter
      ? data.projectMemberDependencies.filter((r) => r.projectId === projectFilter)
      : data.projectMemberDependencies;
    const projectMemberIds = new Set(projectDependencyRows.map((r) => r.memberId));
    const projectPmIds = new Set(
      data.canonical.projects
        .filter((p) => onlyProject(p.projectId))
        .map((p) => p.pmId)
        .filter((id): id is string => Boolean(id)),
    );
    const onlyDeliveryMember = (id: string) => {
      if (memberFilter) return id === memberFilter;
      if (projectFilter) return projectMemberIds.has(id);
      return true;
    };
    const onlyPopulationMember = (id: string) => {
      if (memberFilter) return id === memberFilter;
      if (projectFilter) return projectMemberIds.has(id) || projectPmIds.has(id);
      return true;
    };
    if (!memberFilter && !projectFilter) return data;
    return {
      ...data,
      canonical: {
        ...data.canonical,
        members: data.canonical.members.filter((m) => onlyPopulationMember(m.memberId)),
        projects: data.canonical.projects.filter((p) => onlyProject(p.projectId)),
        allocations: data.canonical.allocations.filter(
          (a) => onlyDeliveryMember(a.memberId) && onlyProject(a.projectId),
        ),
        timesheets: data.canonical.timesheets.filter((t) => onlyDeliveryMember(t.memberId)),
        leaves: data.canonical.leaves.filter((l) =>
          memberFilter ? (l.memberId ?? '') === memberFilter : true,
        ),
      },
      populations: {
        deliveryMembers: data.populations.deliveryMembers.filter((m) =>
          onlyDeliveryMember(m.memberId),
        ),
        projectManagers: data.populations.projectManagers.filter((m) =>
          onlyPopulationMember(m.memberId),
        ),
      },
      projectMemberDependencies: data.projectMemberDependencies.filter(
        (r) => onlyDeliveryMember(r.memberId) && onlyProject(r.projectId),
      ),
      memberWeekFacts: data.memberWeekFacts.filter((f) => onlyDeliveryMember(f.memberId)),
      memberAnalyses: data.memberAnalyses.filter((a) => onlyDeliveryMember(a.memberId)),
      overbookIdleFindings: data.overbookIdleFindings.filter((f) => onlyDeliveryMember(f.memberId)),
      mismatchFindings: data.mismatchFindings.filter((f) => onlyDeliveryMember(f.memberId)),
      answerKey: data.answerKey.filter((r) => onlyDeliveryMember(r.memberId)),
    };
  }, [data, memberFilter, projectFilter]);

  return (
    <PageChrome
      title="Calculation demo"
      subtitle="Utilization analytics pipeline — canonical inputs → member×week facts → member aggregation → findings. KPIs/formulas are computed per member (not per project)."
    >
      <PageChromeToolbar
        left={
          filtered ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-subtle">
              <Badge variant="default">Tenant DB</Badge>
              <span>
                Window {filtered.reportingWindow.start} → {filtered.reportingWindow.end}
              </span>
              <span>
                Answer Key: {filtered.passCount}/{filtered.totalAnswerKey} pass
              </span>
              {memberFilter ? <Badge variant="secondary">Member: {memberFilter}</Badge> : null}
              {projectFilter ? <Badge variant="secondary">Project: {projectFilter}</Badge> : null}
            </div>
          ) : (
            <Badge variant="secondary">{isLoading ? 'Loading…' : 'No data'}</Badge>
          )
        }
      />

      {isLoading ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {noData ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No PMO data for this tenant"
          description="Load PMO_02 into Postgres for your tenant, then reload: run pnpm db:seed locally, or insert-mock.ts then TENANT_ID=<uuid> DATABASE_URL=... insert-mock-to-tenant.ts on a remote host."
        />
      ) : null}

      {isError && !noData ? (
        <p className="text-danger p-6 text-sm">
          {error instanceof Error ? error.message : 'Failed to load'}
        </p>
      ) : null}

      {filtered && thresholdSummary ? (
        <div className="space-y-8 p-6">
          <section className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Thresholds</CardTitle>
                <CardDescription>Resolved from `pmo.overbook_idle_config`.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {thresholdSummary.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-md border border-hairline bg-canvas px-3 py-2"
                    >
                      <p className="text-caption text-ink-subtle">{item.label}</p>
                      <p className="text-body font-medium text-ink">{item.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Window</CardTitle>
                <CardDescription>Calendar weeks included in this run.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-body-sm text-ink-subtle">
                  <div className="flex items-center justify-between">
                    <span>Start</span>
                    <span className="font-medium text-ink">{filtered.reportingWindow.start}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>End</span>
                    <span className="font-medium text-ink">{filtered.reportingWindow.end}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Weeks</span>
                    <span className="font-medium text-ink">{filtered.canonical.weeks.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Counts</CardTitle>
                <CardDescription>Canonical inputs and computed outputs.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-hairline bg-canvas px-3 py-2">
                    <p className="text-caption text-ink-subtle">Members</p>
                    <p className="text-body font-medium text-ink">
                      {filtered.populations.deliveryMembers.length} delivery
                    </p>
                  </div>
                  <div className="rounded-md border border-hairline bg-canvas px-3 py-2">
                    <p className="text-caption text-ink-subtle">PMs</p>
                    <p className="text-body font-medium text-ink">
                      {filtered.populations.projectManagers.length}
                    </p>
                  </div>
                  <div className="rounded-md border border-hairline bg-canvas px-3 py-2">
                    <p className="text-caption text-ink-subtle">Projects</p>
                    <p className="text-body font-medium text-ink">
                      {filtered.inputCounts.projects}
                    </p>
                  </div>
                  <div className="rounded-md border border-hairline bg-canvas px-3 py-2">
                    <p className="text-caption text-ink-subtle">Allocations</p>
                    <p className="text-body font-medium text-ink">
                      {filtered.inputCounts.allocations}
                    </p>
                  </div>
                  <div className="rounded-md border border-hairline bg-canvas px-3 py-2">
                    <p className="text-caption text-ink-subtle">Timesheets</p>
                    <p className="text-body font-medium text-ink">
                      {filtered.inputCounts.timesheets}
                    </p>
                  </div>
                  <div className="rounded-md border border-hairline bg-canvas px-3 py-2">
                    <p className="text-caption text-ink-subtle">Facts</p>
                    <p className="text-body font-medium text-ink">
                      {filtered.memberWeekFacts.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle>Pipeline stages</CardTitle>
                <CardDescription>
                  Filter by member / project to trace the pipeline end-to-end.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="secondary" size="sm">
                          <Filter className="size-4" />
                          Member
                          <ChevronDown className="size-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="p-0">
                        <Command>
                          <CommandInput placeholder="Search member…" />
                          <CommandList>
                            <CommandEmpty>No members found.</CommandEmpty>
                            <CommandGroup heading="Members">
                              {members.map((id) => (
                                <CommandItem
                                  key={id}
                                  onSelect={() => {
                                    setMemberFilter(id);
                                    setFilterOpen(false);
                                  }}
                                >
                                  {id}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    <Popover open={projectFilterOpen} onOpenChange={setProjectFilterOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="secondary" size="sm">
                          <Filter className="size-4" />
                          Project
                          <ChevronDown className="size-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="p-0">
                        <Command>
                          <CommandInput placeholder="Search project…" />
                          <CommandList>
                            <CommandEmpty>No projects found.</CommandEmpty>
                            <CommandGroup heading="Projects">
                              {projects.map((id) => (
                                <CommandItem
                                  key={id}
                                  onSelect={() => {
                                    setProjectFilter(id);
                                    setProjectFilterOpen(false);
                                  }}
                                >
                                  {getProjectLabel(id)}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {memberFilter || projectFilter ? (
                      <>
                        {memberFilter ? (
                          <Badge variant="secondary">Member: {memberFilter}</Badge>
                        ) : null}
                        {projectFilter ? (
                          <Badge variant="secondary">Project: {projectFilter}</Badge>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setMemberFilter(null);
                            setProjectFilter(null);
                          }}
                        >
                          <X className="size-4" />
                          Clear
                        </Button>
                      </>
                    ) : (
                      <span className="text-body-sm text-ink-subtle">
                        Showing all members & projects
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            <h2 className="text-heading-sm font-medium">Stages</h2>
            <Tabs defaultValue="canonical">
              <TabsList className="flex-wrap">
                <TabsTrigger value="canonical">0. Inputs</TabsTrigger>
                <TabsTrigger value="population">1. PM & members</TabsTrigger>
                <TabsTrigger value="facts">2. Facts</TabsTrigger>
                <TabsTrigger value="analysis">3. Aggregation</TabsTrigger>
                <TabsTrigger value="overbookIdle">4a. Overbook / idle</TabsTrigger>
                <TabsTrigger value="mismatch">4b. Mismatch</TabsTrigger>
                <TabsTrigger value="answerKey">5. Answer Key</TabsTrigger>
              </TabsList>

              <TabsContent value="canonical">
                <StagePanel
                  title="Stage 0 — Canonical inputs (pmo.*, is_active=true)"
                  description="Published canonical rows in Postgres. This is the only data the analytics reads."
                >
                  <Tabs defaultValue="members" className="mt-4">
                    <TabsList>
                      <TabsTrigger value="members">
                        Members ({filtered.canonical.members.length})
                      </TabsTrigger>
                      <TabsTrigger value="projects">
                        Projects ({filtered.canonical.projects.length})
                      </TabsTrigger>
                      <TabsTrigger value="allocations">
                        Allocations ({filtered.canonical.allocations.length})
                      </TabsTrigger>
                      <TabsTrigger value="timesheets">
                        Timesheets ({filtered.canonical.timesheets.length})
                      </TabsTrigger>
                      <TabsTrigger value="leaves">
                        Leaves ({filtered.canonical.leaves.length})
                      </TabsTrigger>
                      <TabsTrigger value="weeks">
                        Weeks ({filtered.canonical.weeks.length})
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="members">
                      <DataTable
                        data={filtered.canonical.members}
                        columns={memberColumns(getMemberLabel)}
                      />
                    </TabsContent>
                    <TabsContent value="projects">
                      <DataTable data={filtered.canonical.projects} columns={projectColumns} />
                    </TabsContent>
                    <TabsContent value="allocations">
                      <DataTable
                        data={filtered.canonical.allocations}
                        columns={allocationColumns(getMemberLabel, getProjectLabel, getProjectPm)}
                      />
                    </TabsContent>
                    <TabsContent value="timesheets">
                      <DataTable data={filtered.canonical.timesheets} columns={timesheetColumns} />
                    </TabsContent>
                    <TabsContent value="leaves">
                      <DataTable data={filtered.canonical.leaves} columns={leaveColumns} />
                    </TabsContent>
                    <TabsContent value="weeks">
                      <DataTable data={filtered.canonical.weeks} columns={weekColumns} />
                    </TabsContent>
                  </Tabs>
                </StagePanel>
              </TabsContent>

              <TabsContent value="population">
                <StagePanel
                  title="Stage 1 — PM & project membership"
                  description="Split PMs from delivery members, then show each project with its PM and assigned delivery members from RA."
                >
                  <Tabs defaultValue="projectMembers" className="mt-4">
                    <TabsList>
                      <TabsTrigger value="projectMembers">
                        Project members ({filtered.projectMemberDependencies.length})
                      </TabsTrigger>
                      <TabsTrigger value="deliveryMembers">
                        Delivery members ({filtered.populations.deliveryMembers.length})
                      </TabsTrigger>
                      <TabsTrigger value="projectManagers">
                        PMs ({filtered.populations.projectManagers.length})
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="projectMembers">
                      <DataTable
                        data={filtered.projectMemberDependencies}
                        columns={projectMemberColumns(getMemberLabel, getProjectLabel)}
                      />
                    </TabsContent>
                    <TabsContent value="deliveryMembers">
                      <DataTable
                        data={filtered.populations.deliveryMembers}
                        columns={memberColumns(getMemberLabel)}
                      />
                    </TabsContent>
                    <TabsContent value="projectManagers">
                      <DataTable
                        data={filtered.populations.projectManagers}
                        columns={memberColumns(getMemberLabel)}
                      />
                    </TabsContent>
                  </Tabs>
                </StagePanel>
              </TabsContent>

              <TabsContent value="facts">
                <StagePanel
                  title="Stage 2 — Member × week facts"
                  description="Compute available / planned / logged per delivery member-week → busy rate (N01), effort consumption (N06), plus week-level classification."
                >
                  <div className="mt-3">
                    <DataTable
                      data={filtered.memberWeekFacts}
                      columns={factColumns(getMemberLabel)}
                    />
                  </div>
                </StagePanel>
              </TabsContent>

              <TabsContent value="analysis">
                <StagePanel
                  title="Stage 3 — Member-level aggregation"
                  description="Aggregate facts per delivery member (exclude holiday/leave/approved OT/training weeks) → member busy (mean) and EC = Σlogged/Σplanned."
                >
                  <div className="mt-3">
                    <DataTable
                      data={filtered.memberAnalyses}
                      columns={analysisColumns(getMemberLabel)}
                    />
                  </div>
                </StagePanel>
              </TabsContent>

              <TabsContent value="overbookIdle">
                <StagePanel
                  title="Stage 4a — Overbook / idle detection"
                  description="Compare member busy rate to overbook (yellow/red) and idle thresholds."
                >
                  <div className="mt-3">
                    <DataTable
                      data={filtered.overbookIdleFindings}
                      columns={findingColumns(getMemberLabel)}
                    />
                  </div>
                </StagePanel>
              </TabsContent>

              <TabsContent value="mismatch">
                <StagePanel
                  title="Stage 4b — Mismatch detection"
                  description="Compare |EC − 1| to mismatch threshold → underlog / overlog."
                >
                  <div className="mt-3">
                    <DataTable
                      data={filtered.mismatchFindings}
                      columns={findingColumns(getMemberLabel)}
                    />
                  </div>
                </StagePanel>
              </TabsContent>

              <TabsContent value="answerKey">
                <StagePanel
                  title="Stage 5 — Answer Key validation"
                  description="Compare analytics outputs to expected outcomes from the PMO_02 Answer Key."
                >
                  <div className="mt-3">
                    <DataTable
                      data={filtered.answerKey}
                      columns={answerKeyColumns(getMemberLabel)}
                    />
                  </div>
                </StagePanel>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      ) : null}
    </PageChrome>
  );
}
