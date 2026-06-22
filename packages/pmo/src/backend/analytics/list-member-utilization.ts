import {
  aggregateMemberFacts,
  classifyPrimaryBusyRate,
  detectMismatch,
  detectOverbookIdle,
  type FindingsContext,
} from './findings.ts';
import { loadFactsAndContext } from './findings-context.ts';
import type { MemberWeekFact, RagColor } from './types.ts';

export type MemberUtilizationIssueType =
  | 'overbook'
  | 'idle'
  | 'mismatch_under'
  | 'mismatch_over'
  | 'ok';

export interface MemberUtilizationRow {
  memberId: string;
  busyRate: number | null;
  effortConsumption: number | null;
  issueType: MemberUtilizationIssueType;
  ragColor: RagColor | 'none';
  excludedWeekCount: number;
}

export interface ListMemberUtilizationInput {
  tenantId: string;
  ingestionSessionId?: string;
  dateRange?: { from: Date; to: Date };
  memberId?: string;
  busyRateGt?: number;
  busyRateLt?: number;
  issueTypes?: Array<'overbook' | 'idle' | 'ok' | 'all'>;
}

export interface ListMemberUtilizationResult {
  members: MemberUtilizationRow[];
  summary: {
    totalMembers: number;
    matchedMembers: number;
  };
  dateRange?: { from: string; to: string };
}

function mismatchIssueType(
  memberId: string,
  facts: MemberWeekFact[],
  ctx: FindingsContext,
): MemberUtilizationIssueType | null {
  const finding = detectMismatch(facts, ctx).find((row) => row.memberId === memberId);
  if (!finding) return null;
  return finding.issueType === 'mismatch_over' ? 'mismatch_over' : 'mismatch_under';
}

function classifyMemberRow(
  analysis: ReturnType<typeof aggregateMemberFacts>[number],
  ctx: FindingsContext,
  facts: MemberWeekFact[],
): MemberUtilizationRow {
  const busyRate = analysis.busyRate;
  let issueType: MemberUtilizationIssueType = 'ok';
  let ragColor: RagColor | 'none' = 'none';

  if (busyRate !== null) {
    const busyClass = classifyPrimaryBusyRate(busyRate, ctx.thresholds);
    issueType = busyClass.issueType;
    ragColor = busyClass.ragColor;
  }

  const mismatch = mismatchIssueType(analysis.memberId, facts, ctx);
  if (mismatch) {
    issueType = mismatch;
    ragColor = 'red';
  }

  return {
    memberId: analysis.memberId,
    busyRate: analysis.busyRate,
    effortConsumption: analysis.effortConsumption,
    issueType,
    ragColor,
    excludedWeekCount: analysis.excludedWeeks.length,
  };
}

function matchesIssueFilter(
  issueType: MemberUtilizationIssueType,
  issueTypes: Array<'overbook' | 'idle' | 'ok' | 'all'> | undefined,
): boolean {
  if (!issueTypes || issueTypes.length === 0 || issueTypes.includes('all')) return true;
  if (issueTypes.includes('overbook') && issueType === 'overbook') return true;
  if (issueTypes.includes('idle') && issueType === 'idle') return true;
  if (issueTypes.includes('ok') && issueType === 'ok') return true;
  return false;
}

function matchesBusyRateFilter(
  busyRate: number | null,
  busyRateGt?: number,
  busyRateLt?: number,
): boolean {
  if (busyRate === null) return false;
  if (busyRateGt !== undefined && !(busyRate > busyRateGt)) return false;
  if (busyRateLt !== undefined && !(busyRate < busyRateLt)) return false;
  return true;
}

export async function listMemberUtilization(
  input: ListMemberUtilizationInput,
): Promise<ListMemberUtilizationResult> {
  const { facts, ctx } = await loadFactsAndContext(input.tenantId, {
    ...(input.ingestionSessionId ? { ingestionSessionId: input.ingestionSessionId } : {}),
    ...(input.dateRange ? { dateRange: input.dateRange } : {}),
  });

  const analyses = aggregateMemberFacts(facts, ctx);
  const rows = analyses
    .filter((analysis) => !input.memberId || analysis.memberId === input.memberId)
    .map((analysis) => classifyMemberRow(analysis, ctx, facts))
    .filter((row) => matchesIssueFilter(row.issueType, input.issueTypes))
    .filter((row) => matchesBusyRateFilter(row.busyRate, input.busyRateGt, input.busyRateLt));

  return {
    members: rows,
    summary: {
      totalMembers: analyses.length,
      matchedMembers: rows.length,
    },
    ...(input.dateRange
      ? {
          dateRange: {
            from: input.dateRange.from.toISOString().slice(0, 10),
            to: input.dateRange.to.toISOString().slice(0, 10),
          },
        }
      : {}),
  };
}

export interface MemberDetailResult extends MemberUtilizationRow {
  excludedWeeks: Array<{ weekId: string; reason: string }>;
  weekFacts: Array<{
    weekId: string;
    busyRate: number | null;
    effortConsumption: number | null;
    plannedHours: number;
    availableHours: number;
    loggedHours: number;
  }>;
}

export async function loadMemberUtilizationDetail(
  input: ListMemberUtilizationInput & { memberId: string },
): Promise<MemberDetailResult | null> {
  const { facts, ctx } = await loadFactsAndContext(input.tenantId, {
    ingestionSessionId: input.ingestionSessionId,
    dateRange: input.dateRange,
  });

  const analysis = aggregateMemberFacts(facts, ctx).find((row) => row.memberId === input.memberId);
  if (!analysis) return null;

  const base = classifyMemberRow(analysis, ctx, facts);
  const memberFacts = facts.filter(
    (fact) => fact.memberId === input.memberId && fact.scopeStatus === 'IN_SCOPE',
  );

  return {
    ...base,
    excludedWeeks: analysis.excludedWeeks,
    weekFacts: memberFacts.map((fact) => ({
      weekId: fact.weekId,
      busyRate: fact.busyRate,
      effortConsumption: fact.effortConsumption,
      plannedHours: fact.plannedHours,
      availableHours: fact.availableHours,
      loggedHours: fact.loggedHours,
    })),
  };
}

export function listFlaggedMembersFromDetectors(
  facts: MemberWeekFact[],
  ctx: FindingsContext,
  flaggedTypes: Array<'overbook' | 'idle' | 'mismatch'> | undefined,
): MemberUtilizationRow[] {
  const types = flaggedTypes ?? ['overbook', 'idle', 'mismatch'];
  const byMember = new Map<string, MemberUtilizationRow>();

  if (types.includes('overbook') || types.includes('idle')) {
    for (const finding of detectOverbookIdle(facts, ctx)) {
      if (types.includes('overbook') && finding.issueType === 'overbook') {
        byMember.set(finding.memberId, {
          memberId: finding.memberId,
          busyRate: finding.busyRate,
          effortConsumption: finding.effortConsumption,
          issueType: 'overbook',
          ragColor: finding.ragColor,
          excludedWeekCount: finding.excludedWeeks.length,
        });
      }
      if (types.includes('idle') && finding.issueType === 'idle') {
        byMember.set(finding.memberId, {
          memberId: finding.memberId,
          busyRate: finding.busyRate,
          effortConsumption: finding.effortConsumption,
          issueType: 'idle',
          ragColor: finding.ragColor,
          excludedWeekCount: finding.excludedWeeks.length,
        });
      }
    }
  }

  if (types.includes('mismatch')) {
    for (const finding of detectMismatch(facts, ctx)) {
      byMember.set(finding.memberId, {
        memberId: finding.memberId,
        busyRate: finding.busyRate,
        effortConsumption: finding.effortConsumption,
        issueType: finding.issueType === 'mismatch_over' ? 'mismatch_over' : 'mismatch_under',
        ragColor: finding.ragColor,
        excludedWeekCount: finding.excludedWeeks.length,
      });
    }
  }

  return [...byMember.values()];
}
