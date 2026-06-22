import { and, eq, gte, lte } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  calendarWeeks,
  leaveRecords,
  memberMaster,
  projectMaster,
  resourceAllocations,
} from '../db/schema.ts';
import { mapReportRulesToLegacyThresholds } from '../reporting/rules/compatibility.ts';
import { resolveReportRules } from '../reporting/rules/resolve.ts';
import type { PmoReportRuleSet } from '../reporting/rules/schema.ts';
import type { FindingsContext } from './findings.ts';
import { loadMemberWeekFacts } from './persist-facts.ts';
import type { AllocationRow, MemberWeekFact, ProjectRow, Thresholds } from './types.ts';

export interface ReportMemberEvidence {
  memberId: string;
  fullName: string;
  department: string | null;
  roleTitle: string | null;
  level: string | null;
  lineManagerId: string | null;
  employmentStatus: string | null;
  employmentType: string | null;
  stdHoursWeek: number | null;
  joinDate: Date | null;
}

export interface ReportProjectEvidence extends ProjectRow {
  project_domain: string | null;
}

export interface ReportEvidence {
  facts: MemberWeekFact[];
  ctx: FindingsContext;
  members?: ReportMemberEvidence[];
  projects?: ReportProjectEvidence[];
  allocations?: AllocationRow[];
  reportRules?: PmoReportRuleSet;
}

export interface LoadReportEvidenceOptions {
  dateRange: { from: Date; to: Date };
}

export async function loadReportEvidence(
  tenantId: string,
  options: LoadReportEvidenceOptions,
): Promise<ReportEvidence> {
  const db = pmoDb();
  const { from, to } = options.dateRange;
  const [facts, weeks, leaves, members, projects, allocations, reportRules] = await Promise.all([
    loadMemberWeekFacts(tenantId, { dateRange: options.dateRange }),
    db
      .select({
        week_id: calendarWeeks.week_id,
        week_start: calendarWeeks.week_start,
        week_end: calendarWeeks.week_end,
        working_days: calendarWeeks.working_days,
        holiday_hours_ft: calendarWeeks.holiday_hours_ft,
      })
      .from(calendarWeeks)
      .where(
        and(
          eq(calendarWeeks.tenant_id, tenantId),
          eq(calendarWeeks.is_active, true),
          gte(calendarWeeks.week_end, from),
          lte(calendarWeeks.week_start, to),
        ),
      ),
    db
      .select({
        member_id: leaveRecords.member_id,
        leave_date: leaveRecords.leave_date,
        leave_type: leaveRecords.leave_type,
        approved: leaveRecords.approved,
        duration_days: leaveRecords.duration_days,
      })
      .from(leaveRecords)
      .where(
        and(
          eq(leaveRecords.tenant_id, tenantId),
          eq(leaveRecords.is_active, true),
          gte(leaveRecords.leave_date, from),
          lte(leaveRecords.leave_date, to),
        ),
      ),
    db
      .select({
        memberId: memberMaster.member_id,
        fullName: memberMaster.full_name,
        department: memberMaster.department,
        roleTitle: memberMaster.role_title,
        level: memberMaster.level,
        lineManagerId: memberMaster.line_manager_id,
        employmentStatus: memberMaster.employment_status,
        employmentType: memberMaster.employment,
        stdHoursWeek: memberMaster.std_hours_week,
        joinDate: memberMaster.join_date,
      })
      .from(memberMaster)
      .where(and(eq(memberMaster.tenant_id, tenantId), eq(memberMaster.is_active, true))),
    db
      .select({
        project_id: projectMaster.project_id,
        project_name: projectMaster.project_name,
        account_id: projectMaster.account_id,
        project_type: projectMaster.project_type,
        project_domain: projectMaster.project_type,
        status: projectMaster.status,
        pm_id: projectMaster.pm_id,
        start_date: projectMaster.start_date,
        end_date: projectMaster.end_date,
      })
      .from(projectMaster)
      .where(and(eq(projectMaster.tenant_id, tenantId), eq(projectMaster.is_active, true))),
    db
      .select({
        member_id: resourceAllocations.member_id,
        project_id: resourceAllocations.project_id,
        role: resourceAllocations.role,
        allocation_pct: resourceAllocations.allocation_pct,
        weekly_planned_hours: resourceAllocations.weekly_planned_hours,
        start_date: resourceAllocations.start_date,
        end_date: resourceAllocations.end_date,
      })
      .from(resourceAllocations)
      .where(
        and(
          eq(resourceAllocations.tenant_id, tenantId),
          eq(resourceAllocations.is_active, true),
          gte(resourceAllocations.end_date, from),
          lte(resourceAllocations.start_date, to),
        ),
      ),
    resolveReportRules({ tenantId, effectiveAt: to }),
  ]);

  const legacy = mapReportRulesToLegacyThresholds(reportRules);
  const thresholds: Thresholds = {
    ...legacy,
    requiredTrainingHours: 0,
  };

  return {
    facts,
    members,
    projects,
    allocations,
    reportRules,
    ctx: {
      leaves,
      weeksById: new Map(weeks.map((week) => [week.week_id, week])),
      thresholds,
    },
  };
}
