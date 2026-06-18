import { classifyRag } from './classify.ts';
import { dateInWeek } from './dates.ts';
import { ensureFactsComputed } from './ensure-facts-computed.ts';
import {
  analyzeMembers,
  detectMismatch,
  detectOverbookIdle,
  type MemberAnalysis,
} from './findings.ts';
import { LEAVE_TYPE_APPROVED_OT_COMP, LEAVE_TYPE_TRAINING } from './leave-type.ts';
import type { CanonicalInputs } from './load-canonical.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { loadMemberWeekFacts } from './persist-facts.ts';
import { splitPmoPopulations } from './populations.ts';
import { buildProjectMemberDependencies, type ProjectMemberDependency } from './project-members.ts';
import type { ConfigRow } from './thresholds.ts';
import { resolveThresholds, selectThresholdConfig } from './thresholds.ts';
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
}

export interface DemoAnalyticsOptions {
  dateRange?: { from: Date; to: Date };
  configEffectiveDate?: Date;
  thresholdOverrides?: Partial<Thresholds>;
}

function isoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function findingLabel(finding: Finding): string {
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

function classifyFact(
  f: MemberWeekFact,
  thresholds: Thresholds,
): Pick<MemberWeekFact, 'ragColor' | 'issueType'> {
  return classifyRag(
    {
      availableHours: f.availableHours,
      plannedHours: f.plannedHours,
      loggedHours: f.loggedHours,
      expectedLoggedHours: f.expectedLoggedHours,
      billableHours: f.billableHours,
      benchHours: f.benchHours,
      overtimeHours: f.overtimeHours,
      trainingHours: f.trainingHours,
      busyRate: f.busyRate,
      utilization: f.utilization,
      billableRate: f.billableRate,
      benchRate: f.benchRate,
      overtimeRatio: f.overtimeRatio,
      effortConsumption: f.effortConsumption,
      trainingCompliance: f.trainingCompliance,
    },
    thresholds,
  );
}

function serializeFact(f: MemberWeekFact, thresholds: Thresholds): DemoMemberWeekRow {
  const classification = classifyFact(f, thresholds);
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
    ragColor: classification.ragColor,
    issueType: classification.issueType,
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

function thresholdConfigMeta(row: ConfigRow | undefined): DemoAnalyticsResult['thresholdConfig'] {
  return {
    configId: row?.config_id ?? null,
    ruleName: row?.rule_name ?? null,
    effectiveDate: isoDate(row?.effective_date) ?? null,
  };
}

function applyThresholdOverrides(base: Thresholds, overrides?: Partial<Thresholds>): Thresholds {
  if (!overrides) return base;
  return {
    ...base,
    ...(overrides.overbookThreshold !== undefined
      ? { overbookThreshold: overrides.overbookThreshold }
      : {}),
    ...(overrides.overbookRedThreshold !== undefined
      ? { overbookRedThreshold: overrides.overbookRedThreshold }
      : {}),
    ...(overrides.idleThreshold !== undefined ? { idleThreshold: overrides.idleThreshold } : {}),
    ...(overrides.mismatchPctThreshold !== undefined
      ? { mismatchPctThreshold: overrides.mismatchPctThreshold }
      : {}),
    ...(overrides.otMaxHoursPerWeek !== undefined
      ? { otMaxHoursPerWeek: overrides.otMaxHoursPerWeek }
      : {}),
    ...(overrides.requiredTrainingHours !== undefined
      ? { requiredTrainingHours: overrides.requiredTrainingHours }
      : {}),
  };
}

export function buildDemoAnalyticsResult(
  canonical: CanonicalInputs,
  facts: MemberWeekFact[],
  options: Pick<DemoAnalyticsOptions, 'configEffectiveDate' | 'thresholdOverrides'> = {},
): DemoAnalyticsResult {
  const { members, projects, allocations, timesheets, leaves, weeks, configRows } = canonical;
  const selectedConfig = selectThresholdConfig(configRows, {
    effectiveDate: options.configEffectiveDate,
  });
  const thresholds = applyThresholdOverrides(
    resolveThresholds(configRows, { effectiveDate: options.configEffectiveDate }),
    options.thresholdOverrides,
  );
  const weekIds = new Set(weeks.map((w) => w.week_id));
  const scopedFacts = facts.filter((f) => weekIds.has(f.weekId));
  const { deliveryMembers, projectManagers } = splitPmoPopulations(members, projects);
  const projectMemberDependencies = buildProjectMemberDependencies(
    projects,
    deliveryMembers,
    allocations,
  );

  const weeksById = new Map(weeks.map((w) => [w.week_id, w]));
  const ctx = { leaves, weeksById, thresholds };
  const overbookIdle = detectOverbookIdle(scopedFacts, ctx);
  const mismatch = detectMismatch(scopedFacts, ctx);
  const analyses = analyzeMembers(scopedFacts, ctx);

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
    thresholdConfig: thresholdConfigMeta(selectedConfig),
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
    memberWeekFacts: scopedFacts.map((f) => {
      const row = serializeFact(f, thresholds);
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
  };
}

export async function runDemoAnalytics(
  tenantId: string,
  options: DemoAnalyticsOptions = {},
): Promise<DemoAnalyticsResult> {
  const canonical = await loadCanonicalInputs(tenantId, { dateRange: options.dateRange });
  if (canonical.members.length === 0 || canonical.weeks.length === 0) {
    throw new DemoAnalyticsNoDataError();
  }

  await ensureFactsComputed(tenantId);

  const facts = await loadMemberWeekFacts(tenantId);
  if (facts.length === 0) {
    throw new DemoAnalyticsNoDataError();
  }

  return buildDemoAnalyticsResult(canonical, facts, {
    configEffectiveDate: options.configEffectiveDate ?? options.dateRange?.from,
    thresholdOverrides: options.thresholdOverrides,
  });
}
