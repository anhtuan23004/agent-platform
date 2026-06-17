import { PMO_02_ANSWER_KEY } from '../demo/pmo-02.ts';
import { dateInWeek } from './dates.ts';
import {
  analyzeMembers,
  detectMismatch,
  detectOverbookIdle,
  type MemberAnalysis,
} from './findings.ts';
import { LEAVE_TYPE_APPROVED_OT_COMP, LEAVE_TYPE_TRAINING } from './leave-type.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts } from './member-week-facts.ts';
import { splitPmoPopulations } from './populations.ts';
import { buildProjectMemberDependencies, type ProjectMemberDependency } from './project-members.ts';
import { resolveThresholds } from './thresholds.ts';
import type {
  AllocationRow,
  Finding,
  LeaveRow,
  MemberRow,
  MemberWeekFact,
  ProjectRow,
  Thresholds,
  TimesheetRow,
  WeekRow,
} from './types.ts';

export class DemoAnalyticsNoDataError extends Error {
  constructor() {
    super(
      'No PMO canonical data for this tenant. Run pnpm db:seed or insert-mock-to-tenant.ts first.',
    );
    this.name = 'DemoAnalyticsNoDataError';
  }
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

export interface DemoCanonicalInputs {
  members: DemoMemberInput[];
  projects: DemoProjectInput[];
  allocations: DemoAllocationInput[];
  timesheets: DemoTimesheetInput[];
  leaves: DemoLeaveInput[];
  weeks: DemoWeekInput[];
}

export interface DemoAnalyticsResult {
  reportingWindow: { start: string; end: string };
  thresholds: Thresholds;
  inputCounts: {
    members: number;
    projects: number;
    allocations: number;
    timesheets: number;
    leaves: number;
    weeks: number;
  };
  canonical: DemoCanonicalInputs;
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

function isoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function findingLabel(finding: Finding | undefined): string {
  if (!finding) return '(none)';
  switch (finding.issueType) {
    case 'overbook':
      return 'Overbook';
    case 'idle':
      return 'Idle';
    case 'mismatch_under':
      return 'Mismatch_underlog';
    case 'mismatch_over':
      return 'Mismatch_overlog';
    default:
      return finding.issueType;
  }
}

function compareAnswerKey(expected: string, actual: string): boolean {
  const norm = (s: string) => (s === '(none)' ? '(none)' : s);
  return norm(expected) === norm(actual);
}

function serializeFinding(f: Finding): DemoFindingRow {
  return {
    memberId: f.memberId,
    issueType: findingLabel(f),
    ragColor: f.ragColor,
    busyRate: f.busyRate,
    effortConsumption: f.effortConsumption,
    detail: f.detail,
    excludedWeeks: f.excludedWeeks,
  };
}

function serializeFact(f: MemberWeekFact): DemoMemberWeekRow {
  return {
    memberId: f.memberId,
    weekId: f.weekId,
    scopeStatus: f.scopeStatus,
    availableHours: f.availableHours,
    plannedHours: f.plannedHours,
    loggedHours: f.loggedHours,
    expectedLoggedHours: f.expectedLoggedHours,
    busyRate: f.busyRate,
    effortConsumption: f.effortConsumption,
    ragColor: f.ragColor,
    issueType: f.issueType,
    suppressionReason: null,
  };
}

function hasApprovedType(
  memberId: string,
  week: WeekRow,
  leaves: LeaveRow[],
  leaveTypeLower: string,
): boolean {
  return leaves.some(
    (l) =>
      l.member_id === memberId &&
      l.approved === true &&
      l.leave_type.trim().toLowerCase() === leaveTypeLower &&
      dateInWeek(l.leave_date, week),
  );
}

function suppressionReasonForFact(
  fact: MemberWeekFact,
  week: WeekRow | undefined,
  leaves: LeaveRow[],
): string | null {
  if (fact.scopeStatus !== 'IN_SCOPE') return 'pre_hire';
  if (week && (week.holiday_hours_ft ?? 0) > 0) return 'holiday_week';
  if (week && hasApprovedType(fact.memberId, week, leaves, LEAVE_TYPE_APPROVED_OT_COMP))
    return 'approved_ot';
  if (week && hasApprovedType(fact.memberId, week, leaves, LEAVE_TYPE_TRAINING)) return 'training';
  if (fact.availableHours === 0) return 'approved_leave';
  if (fact.availableHours > 0 && fact.plannedHours === 0 && fact.loggedHours === 0)
    return 'no_plan';
  return null;
}

function serializeAnalysis(a: MemberAnalysis): DemoMemberAnalysisRow {
  return {
    memberId: a.memberId,
    inScopeWeekCount: a.inScopeWeekCount,
    busyRate: a.busyRate,
    effortConsumption: a.effortConsumption,
    excludedWeeks: a.excludedWeeks,
  };
}

function serializeMember(m: MemberRow): DemoMemberInput {
  return {
    memberId: m.member_id,
    fullName: m.full_name,
    roleTitle: m.role_title ?? null,
    stdHoursWeek: m.std_hours_week,
    joinDate: isoDate(m.join_date),
  };
}

function serializeCanonical(
  members: MemberRow[],
  projects: ProjectRow[],
  allocations: AllocationRow[],
  timesheets: TimesheetRow[],
  leaves: LeaveRow[],
  weeks: WeekRow[],
): DemoCanonicalInputs {
  return {
    members: members.map(serializeMember),
    projects: projects.map((p) => ({
      projectId: p.project_id,
      projectName: p.project_name,
      accountId: p.account_id,
      projectType: p.project_type,
      status: p.status,
      pmId: p.pm_id,
      startDate: isoDate(p.start_date),
      endDate: isoDate(p.end_date),
    })),
    allocations: allocations.map((a) => ({
      memberId: a.member_id,
      projectId: a.project_id,
      role: a.role ?? null,
      weeklyPlannedHours: a.weekly_planned_hours,
      startDate: isoDate(a.start_date) ?? '',
      endDate: isoDate(a.end_date) ?? '',
    })),
    timesheets: timesheets.map((t) => ({
      memberId: t.member_id,
      workDate: isoDate(t.work_date) ?? '',
      loggedHours: t.logged_hours,
      logCategory: t.log_category ?? null,
    })),
    leaves: leaves.map((l) => ({
      memberId: l.member_id,
      leaveDate: isoDate(l.leave_date) ?? '',
      leaveType: l.leave_type,
      approved: l.approved,
      durationDays: l.duration_days,
    })),
    weeks: weeks.map((w) => ({
      weekId: w.week_id,
      weekStart: isoDate(w.week_start) ?? '',
      weekEnd: isoDate(w.week_end) ?? '',
      workingDays: w.working_days,
      holidayHoursFt: w.holiday_hours_ft,
    })),
  };
}

function serializeProjectMemberDependency(
  row: ProjectMemberDependency,
): DemoProjectMemberDependencyRow {
  return {
    projectId: row.projectId,
    projectName: row.projectName,
    pmId: row.pmId,
    pmName: row.pmName,
    memberId: row.memberId,
    memberName: row.memberName,
    memberRoleTitle: row.memberRoleTitle,
    allocationRole: row.allocationRole,
    weeklyPlannedHours: row.weeklyPlannedHours,
  };
}

function reportingWindow(weeks: WeekRow[]): { start: string; end: string } {
  if (weeks.length === 0) return { start: '', end: '' };
  const starts = weeks.map((w) => w.week_start.getTime());
  const ends = weeks.map((w) => w.week_end.getTime());
  return {
    start: isoDate(new Date(Math.min(...starts))) ?? '',
    end: isoDate(new Date(Math.max(...ends))) ?? '',
  };
}

function buildAnswerKeyRows(
  analyses: MemberAnalysis[],
  overbookIdle: Finding[],
  mismatch: Finding[],
): DemoAnswerKeyRow[] {
  const allFindings = [...overbookIdle, ...mismatch];
  return PMO_02_ANSWER_KEY.map(({ memberId, expected }) => {
    const finding = allFindings.find((f) => f.memberId === memberId);
    const analysis = analyses.find((a) => a.memberId === memberId);
    const actual = findingLabel(finding);
    return {
      memberId,
      expected,
      actual,
      match: compareAnswerKey(expected, actual),
      busyRate: analysis?.busyRate ?? finding?.busyRate ?? null,
      effortConsumption: analysis?.effortConsumption ?? finding?.effortConsumption ?? null,
      excludedWeeks: analysis?.excludedWeeks ?? finding?.excludedWeeks ?? [],
    };
  });
}

export function buildDemoAnalyticsResult(
  members: MemberRow[],
  projects: ProjectRow[],
  allocations: AllocationRow[],
  timesheets: TimesheetRow[],
  leaves: LeaveRow[],
  weeks: WeekRow[],
  configRows: Awaited<ReturnType<typeof loadCanonicalInputs>>['configRows'],
): DemoAnalyticsResult {
  const thresholds = resolveThresholds(configRows);
  const { deliveryMembers, projectManagers } = splitPmoPopulations(members, projects);
  const projectMemberDependencies = buildProjectMemberDependencies(
    projects,
    deliveryMembers,
    allocations,
  );
  const facts = buildMemberWeekFacts({
    members: deliveryMembers,
    allocations,
    timesheets,
    leaves,
    weeks,
    thresholds,
  });

  const weeksById = new Map(weeks.map((w) => [w.week_id, w]));
  const ctx = { leaves, weeksById, thresholds };
  const overbookIdle = detectOverbookIdle(facts, ctx);
  const mismatch = detectMismatch(facts, ctx);
  const analyses = analyzeMembers(facts, ctx);
  const answerKey = buildAnswerKeyRows(analyses, overbookIdle, mismatch);

  const memberIdToLeaves = new Map<string, LeaveRow[]>();
  for (const l of leaves) {
    if (!l.member_id) continue;
    const list = memberIdToLeaves.get(l.member_id) ?? [];
    list.push(l);
    memberIdToLeaves.set(l.member_id, list);
  }

  return {
    reportingWindow: reportingWindow(weeks),
    thresholds,
    inputCounts: {
      members: members.length,
      projects: projects.length,
      allocations: allocations.length,
      timesheets: timesheets.length,
      leaves: leaves.length,
      weeks: weeks.length,
    },
    canonical: serializeCanonical(members, projects, allocations, timesheets, leaves, weeks),
    populations: {
      deliveryMembers: deliveryMembers.map(serializeMember),
      projectManagers: projectManagers.map(serializeMember),
    },
    projectMemberDependencies: projectMemberDependencies.map(serializeProjectMemberDependency),
    memberWeekFacts: facts.map((f) => {
      const row = serializeFact(f);
      const week = weeksById.get(f.weekId);
      row.suppressionReason = suppressionReasonForFact(
        f,
        week,
        memberIdToLeaves.get(f.memberId) ?? [],
      );
      return row;
    }),
    memberAnalyses: analyses
      .map(serializeAnalysis)
      .sort((a, b) => a.memberId.localeCompare(b.memberId)),
    overbookIdleFindings: overbookIdle.map(serializeFinding),
    mismatchFindings: mismatch.map(serializeFinding),
    answerKey,
    passCount: answerKey.filter((r) => r.match).length,
    totalAnswerKey: answerKey.length,
  };
}

export async function runDemoAnalytics(tenantId: string): Promise<DemoAnalyticsResult> {
  const canonical = await loadCanonicalInputs(tenantId);
  if (canonical.members.length === 0 || canonical.weeks.length === 0) {
    throw new DemoAnalyticsNoDataError();
  }

  return buildDemoAnalyticsResult(
    canonical.members,
    canonical.projects,
    canonical.allocations,
    canonical.timesheets,
    canonical.leaves,
    canonical.weeks,
    canonical.configRows,
  );
}
