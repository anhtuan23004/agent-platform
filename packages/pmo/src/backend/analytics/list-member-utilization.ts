import { and, eq, inArray } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { memberMaster } from '../db/schema.ts';
import { buildFallbackFindingExplanation } from '../reporting/explanations/report-explanations.ts';
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

export interface MemberUtilizationExplanation {
  summary: string;
  riskTradeoffs: string[];
}

export interface MemberUtilizationRow {
  memberId: string;
  fullName: string | null;
  department: string | null;
  roleTitle: string | null;
  busyRate: number | null;
  effortConsumption: number | null;
  issueType: MemberUtilizationIssueType;
  ragColor: RagColor | 'none';
  excludedWeekCount: number;
  detail: string | null;
  explanation: MemberUtilizationExplanation | null;
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

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${Math.round(n * 100)}%`;
}

function buildIssueDetail(
  issueType: MemberUtilizationIssueType,
  busyRate: number | null,
  effortConsumption: number | null,
): string | null {
  if (issueType === 'overbook') return `Busy ${pct(busyRate)} — overbooked, rebalance`;
  if (issueType === 'idle') return `Busy ${pct(busyRate)} — under-allocated`;
  if (issueType === 'mismatch_under') {
    return `Effort consumption ${pct(effortConsumption)} — logged below plan`;
  }
  if (issueType === 'mismatch_over') {
    return `Effort consumption ${pct(effortConsumption)} — logged above plan`;
  }
  return null;
}

function buildExplanationForRow(row: {
  issueType: MemberUtilizationIssueType;
  busyRate: number | null;
  effortConsumption: number | null;
  detail: string | null;
}): MemberUtilizationExplanation | null {
  if (!row.detail) return null;
  return buildFallbackFindingExplanation({
    issueType: row.issueType,
    busyRate: row.busyRate,
    effortConsumption: row.effortConsumption,
    detail: row.detail,
  });
}

async function loadMemberProfiles(
  tenantId: string,
  memberIds: string[],
  ingestionSessionId?: string,
): Promise<Map<string, { fullName: string; department: string | null; roleTitle: string | null }>> {
  if (memberIds.length === 0) return new Map();

  const db = pmoDb();
  const rows = await db
    .select({
      memberId: memberMaster.member_id,
      fullName: memberMaster.full_name,
      department: memberMaster.department,
      roleTitle: memberMaster.role_title,
    })
    .from(memberMaster)
    .where(
      and(
        eq(memberMaster.tenant_id, tenantId),
        eq(memberMaster.is_active, true),
        inArray(memberMaster.member_id, memberIds),
        ...(ingestionSessionId
          ? [eq(memberMaster.last_ingestion_session_id, ingestionSessionId)]
          : []),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.memberId,
      {
        fullName: row.fullName,
        department: row.department,
        roleTitle: row.roleTitle,
      },
    ]),
  );
}

export async function enrichMemberUtilizationRows(
  tenantId: string,
  rows: MemberUtilizationRow[],
  ingestionSessionId?: string,
): Promise<MemberUtilizationRow[]> {
  const profiles = await loadMemberProfiles(
    tenantId,
    rows.map((row) => row.memberId),
    ingestionSessionId,
  );

  return rows.map((row) => {
    const profile = profiles.get(row.memberId);
    const detail =
      row.detail ?? buildIssueDetail(row.issueType, row.busyRate, row.effortConsumption);
    return {
      ...row,
      fullName: profile?.fullName ?? row.fullName ?? null,
      department: profile?.department ?? row.department ?? null,
      roleTitle: profile?.roleTitle ?? row.roleTitle ?? null,
      detail,
      explanation: row.explanation ?? buildExplanationForRow({ ...row, detail }),
    };
  });
}

function memberRow(
  partial: Omit<
    MemberUtilizationRow,
    'fullName' | 'department' | 'roleTitle' | 'detail' | 'explanation'
  > & {
    fullName?: string | null;
    department?: string | null;
    roleTitle?: string | null;
    detail?: string | null;
    explanation?: MemberUtilizationExplanation | null;
  },
): MemberUtilizationRow {
  return {
    memberId: partial.memberId,
    busyRate: partial.busyRate,
    effortConsumption: partial.effortConsumption,
    issueType: partial.issueType,
    ragColor: partial.ragColor,
    excludedWeekCount: partial.excludedWeekCount,
    fullName: partial.fullName ?? null,
    department: partial.department ?? null,
    roleTitle: partial.roleTitle ?? null,
    detail: partial.detail ?? null,
    explanation: partial.explanation ?? null,
  };
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

  return memberRow({
    memberId: analysis.memberId,
    busyRate: analysis.busyRate,
    effortConsumption: analysis.effortConsumption,
    issueType,
    ragColor,
    excludedWeekCount: analysis.excludedWeeks.length,
  });
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

  const members = await enrichMemberUtilizationRows(input.tenantId, rows, input.ingestionSessionId);

  return {
    members,
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

  const [enriched] = await enrichMemberUtilizationRows(
    input.tenantId,
    [base],
    input.ingestionSessionId,
  );
  if (!enriched) return null;

  return {
    ...enriched,
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
        byMember.set(
          finding.memberId,
          memberRow({
            memberId: finding.memberId,
            busyRate: finding.busyRate,
            effortConsumption: finding.effortConsumption,
            issueType: 'overbook',
            ragColor: finding.ragColor,
            excludedWeekCount: finding.excludedWeeks.length,
            detail: finding.detail,
            explanation: buildExplanationForRow({
              issueType: 'overbook',
              busyRate: finding.busyRate,
              effortConsumption: finding.effortConsumption,
              detail: finding.detail,
            }),
          }),
        );
      }
      if (types.includes('idle') && finding.issueType === 'idle') {
        byMember.set(
          finding.memberId,
          memberRow({
            memberId: finding.memberId,
            busyRate: finding.busyRate,
            effortConsumption: finding.effortConsumption,
            issueType: 'idle',
            ragColor: finding.ragColor,
            excludedWeekCount: finding.excludedWeeks.length,
            detail: finding.detail,
            explanation: buildExplanationForRow({
              issueType: 'idle',
              busyRate: finding.busyRate,
              effortConsumption: finding.effortConsumption,
              detail: finding.detail,
            }),
          }),
        );
      }
    }
  }

  if (types.includes('mismatch')) {
    for (const finding of detectMismatch(facts, ctx)) {
      const issueType = finding.issueType === 'mismatch_over' ? 'mismatch_over' : 'mismatch_under';
      byMember.set(
        finding.memberId,
        memberRow({
          memberId: finding.memberId,
          busyRate: finding.busyRate,
          effortConsumption: finding.effortConsumption,
          issueType,
          ragColor: finding.ragColor,
          excludedWeekCount: finding.excludedWeeks.length,
          detail: finding.detail,
          explanation: buildExplanationForRow({
            issueType,
            busyRate: finding.busyRate,
            effortConsumption: finding.effortConsumption,
            detail: finding.detail,
          }),
        }),
      );
    }
  }

  return [...byMember.values()];
}
