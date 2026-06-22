export interface DemoThresholds {
  overbookThreshold: number;
  overbookRedThreshold: number;
  idleThreshold: number;
  idleYellowThreshold: number;
  mismatchPctThreshold: number;
  otMaxHoursPerWeek: number;
  requiredTrainingHours: number;
}

export interface DemoAnalyticsSettings {
  from?: string;
  to?: string;
  configEffectiveDate?: string;
  ingestionSessionId?: string;
  thresholds?: Partial<
    Pick<
      DemoThresholds,
      | 'overbookThreshold'
      | 'overbookRedThreshold'
      | 'idleThreshold'
      | 'idleYellowThreshold'
      | 'mismatchPctThreshold'
    >
  >;
}

export interface DemoFindingRow {
  memberId: string;
  issueType: string;
  ragColor: string;
  busyRate: number | null;
  effortConsumption: number | null;
  detail: string;
  excludedWeeks: Array<{ weekId: string; reason: string }>;
}

export interface DemoMemberAnalysisRow {
  memberId: string;
  inScopeWeekCount: number;
  busyRate: number | null;
  effortConsumption: number | null;
  excludedWeeks: Array<{ weekId: string; reason: string }>;
}

export interface DemoMemberInput {
  memberId: string;
  fullName: string;
  roleTitle: string | null;
  stdHoursWeek: number | null;
  joinDate: string | null;
}

export interface DemoProjectInput {
  projectId: string;
  projectName: string;
  accountId: string | null;
  projectType: string | null;
  status: string | null;
  pmId: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface DemoAllocationInput {
  memberId: string;
  projectId: string;
  role: string | null;
  weeklyPlannedHours: number | null;
  startDate: string;
  endDate: string;
}

export interface DemoProjectMemberDependencyRow {
  projectId: string;
  projectName: string;
  pmId: string | null;
  pmName: string | null;
  memberId: string;
  memberName: string;
  memberRoleTitle: string | null;
  allocationRole: string | null;
  weeklyPlannedHours: number;
  plannedHoursInWindow: number;
  loggedHours: number;
  capacityShare: number | null;
  effortConsumption: number | null;
  allocationStartDate: string;
  allocationEndDate: string;
  projectStartDate: string | null;
  projectEndDate: string | null;
  projectStatus: string | null;
}

export interface DemoTimesheetInput {
  memberId: string;
  projectId: string | null;
  workDate: string;
  loggedHours: number;
  logCategory: string | null;
}

export interface DemoLeaveInput {
  memberId: string | null;
  leaveDate: string;
  leaveType: string;
  approved: boolean | null;
  durationDays: number | null;
}

export interface DemoWeekInput {
  weekId: string;
  weekStart: string;
  weekEnd: string;
  workingDays: number;
  holidayHoursFt: number | null;
}

export interface DemoMemberWeekRow {
  memberId: string;
  weekId: string;
  scopeStatus: string;
  availableHours: number;
  plannedHours: number;
  loggedHours: number;
  expectedLoggedHours: number;
  busyRate: number | null;
  effortConsumption: number | null;
  ragColor: string;
  issueType: string;
  suppressionReason: string | null;
}

export interface DemoMemberWeekProjectRow {
  memberId: string;
  weekId: string;
  projectId: string;
  projectName: string;
  scopeStatus: string;
  suppressionReason: string | null;
  plannedHours: number;
  loggedHours: number;
  capacityShare: number | null;
  effortConsumption: number | null;
  allocationStartDate: string;
  allocationEndDate: string;
  projectStartDate: string | null;
  projectEndDate: string | null;
  projectStatus: string | null;
}

export interface DemoAnalyticsResult {
  reportingWindow: { start: string; end: string };
  thresholds: DemoThresholds;
  thresholdConfig: {
    configId: string | null;
    ruleName: string | null;
    effectiveDate: string | null;
  };
  inputCounts: {
    members: number;
    projects: number;
    allocations: number;
    timesheets: number;
    leaves: number;
    weeks: number;
  };
  canonical: {
    members: DemoMemberInput[];
    projects: DemoProjectInput[];
    allocations: DemoAllocationInput[];
    timesheets: DemoTimesheetInput[];
    leaves: DemoLeaveInput[];
    weeks: DemoWeekInput[];
  };
  populations: {
    deliveryMembers: DemoMemberInput[];
    projectManagers: DemoMemberInput[];
  };
  projectMemberDependencies: DemoProjectMemberDependencyRow[];
  memberWeekFacts: DemoMemberWeekRow[];
  memberWeekProjectFacts: DemoMemberWeekProjectRow[];
  memberAnalyses: DemoMemberAnalysisRow[];
  overbookIdleFindings: DemoFindingRow[];
  mismatchFindings: DemoFindingRow[];
}

export function demoAnalyticsQueryKey(settings?: DemoAnalyticsSettings) {
  const thresholds = settings?.thresholds;
  return [
    'pmo',
    'demo-analytics',
    settings?.from ?? null,
    settings?.to ?? null,
    settings?.configEffectiveDate ?? null,
    settings?.ingestionSessionId ?? null,
    thresholds?.overbookThreshold ?? null,
    thresholds?.overbookRedThreshold ?? null,
    thresholds?.idleThreshold ?? null,
    thresholds?.idleYellowThreshold ?? null,
    thresholds?.mismatchPctThreshold ?? null,
  ] as const;
}

function buildQuery(settings?: DemoAnalyticsSettings): string {
  const params = new URLSearchParams();
  if (settings?.from && settings.to) {
    params.set('from', settings.from);
    params.set('to', settings.to);
  }
  if (settings?.configEffectiveDate) {
    params.set('configEffectiveDate', settings.configEffectiveDate);
  }
  if (settings?.ingestionSessionId) {
    params.set('ingestion_session_id', settings.ingestionSessionId);
  }
  const thresholds = settings?.thresholds;
  if (thresholds?.overbookThreshold !== undefined) {
    params.set('overbookThreshold', String(thresholds.overbookThreshold));
  }
  if (thresholds?.overbookRedThreshold !== undefined) {
    params.set('overbookRedThreshold', String(thresholds.overbookRedThreshold));
  }
  if (thresholds?.idleThreshold !== undefined) {
    params.set('idleThreshold', String(thresholds.idleThreshold));
  }
  if (thresholds?.idleYellowThreshold !== undefined) {
    params.set('idleYellowThreshold', String(thresholds.idleYellowThreshold));
  }
  if (thresholds?.mismatchPctThreshold !== undefined) {
    params.set('mismatchPctThreshold', String(thresholds.mismatchPctThreshold));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function fetchDemoAnalytics(
  settings?: DemoAnalyticsSettings,
): Promise<DemoAnalyticsResult> {
  const res = await fetch(`/api/pmo/v1/demo-analytics${buildQuery(settings)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (res.status === 404 && body.error === 'no_data') {
      throw new Error(body.message ?? 'No PMO canonical data for this tenant.');
    }
    throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<DemoAnalyticsResult>;
}
