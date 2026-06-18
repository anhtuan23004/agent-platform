import { detectOverbookIdle, type FindingsContext } from './findings.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts } from './member-week-facts.ts';
import { splitPmoPopulations } from './populations.ts';
import { resolveThresholds } from './thresholds.ts';
import type { Finding } from './types.ts';

export type PmoReportType = 'idle_members' | 'overbook_members';

export interface PmoReportDateRange {
  from: string;
  to: string;
}

export interface GeneratePmoReportInput {
  tenantId: string;
  ingestionSessionId?: string;
  dateRange: PmoReportDateRange;
  reportTypes: PmoReportType[];
}

export interface GeneratePmoReportOutput {
  dateRange: PmoReportDateRange;
  summary: {
    memberCount: number;
    overbookCount: number;
    idleCount: number;
    excludedWeekCount: number;
  };
  findings: Array<
    Pick<
      Finding,
      'memberId' | 'issueType' | 'ragColor' | 'busyRate' | 'effortConsumption' | 'detail'
    > & {
      excludedWeeks: Array<{ weekId: string; reason: string }>;
    }
  >;
}

function parseReportDate(value: string, label: 'from' | 'to'): Date {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) || Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid_report_date:${label}`);
  }
  return parsed;
}

function reportTypeAllows(types: PmoReportType[], issueType: Finding['issueType']): boolean {
  if (issueType === 'idle') return types.includes('idle_members');
  if (issueType === 'overbook') return types.includes('overbook_members');
  return false;
}

export async function generatePmoReport(
  input: GeneratePmoReportInput,
): Promise<GeneratePmoReportOutput> {
  const from = parseReportDate(input.dateRange.from, 'from');
  const to = parseReportDate(input.dateRange.to, 'to');
  if (from.getTime() > to.getTime()) {
    throw new Error('invalid_report_date_range');
  }

  const inputs = await loadCanonicalInputs(input.tenantId, {
    dateRange: { from, to },
  });
  const thresholds = resolveThresholds(inputs.configRows);
  const { deliveryMembers } = splitPmoPopulations(inputs.members, inputs.projects);
  const facts = buildMemberWeekFacts({
    members: deliveryMembers,
    allocations: inputs.allocations,
    timesheets: inputs.timesheets,
    leaves: inputs.leaves,
    weeks: inputs.weeks,
    thresholds,
  });
  const ctx: FindingsContext = {
    leaves: inputs.leaves,
    weeksById: new Map(inputs.weeks.map((week) => [week.week_id, week])),
    thresholds,
  };
  const findings = detectOverbookIdle(facts, ctx).filter((finding) =>
    reportTypeAllows(input.reportTypes, finding.issueType),
  );

  return {
    dateRange: {
      from: input.dateRange.from.slice(0, 10),
      to: input.dateRange.to.slice(0, 10),
    },
    summary: {
      memberCount: deliveryMembers.length,
      overbookCount: findings.filter((finding) => finding.issueType === 'overbook').length,
      idleCount: findings.filter((finding) => finding.issueType === 'idle').length,
      excludedWeekCount: findings.reduce((sum, finding) => sum + finding.excludedWeeks.length, 0),
    },
    findings: findings.map((finding) => ({
      memberId: finding.memberId,
      issueType: finding.issueType,
      ragColor: finding.ragColor,
      busyRate: finding.busyRate,
      effortConsumption: finding.effortConsumption,
      detail: finding.detail,
      excludedWeeks: finding.excludedWeeks,
    })),
  };
}
