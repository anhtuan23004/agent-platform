export interface DemoThresholds {
  overbookThreshold: number;
  overbookRedThreshold: number;
  idleThreshold: number;
  mismatchPctThreshold: number;
  otMaxHoursPerWeek: number;
  requiredTrainingHours: number;
}

export interface DemoAnswerKeyRow {
  memberId: string;
  expected: string;
  actual: string;
  match: boolean;
  busyRate: number | null;
  effortConsumption: number | null;
  excludedWeeks: Array<{ weekId: string; reason: string }>;
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
}

export interface DemoTimesheetInput {
  memberId: string;
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

export interface DemoAnalyticsResult {
  reportingWindow: { start: string; end: string };
  thresholds: DemoThresholds;
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
  memberAnalyses: DemoMemberAnalysisRow[];
  overbookIdleFindings: DemoFindingRow[];
  mismatchFindings: DemoFindingRow[];
  answerKey: DemoAnswerKeyRow[];
  passCount: number;
  totalAnswerKey: number;
}

export async function fetchDemoAnalytics(): Promise<DemoAnalyticsResult> {
  const res = await fetch('/api/pmo/v1/demo-analytics', { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (res.status === 404 && body.error === 'no_data') {
      throw new Error(body.message ?? 'No PMO canonical data for this tenant.');
    }
    throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<DemoAnalyticsResult>;
}
