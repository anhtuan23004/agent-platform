import { dateInWeek } from './dates.ts';
import { isApprovedOtCompLeave, isTrainingLeave } from './leave-type.ts';
import type {
  ExcludedWeek,
  Finding,
  LeaveRow,
  MemberWeekFact,
  RagColor,
  SuppressionReason,
  Thresholds,
  WeekRow,
} from './types.ts';

export interface FindingsContext {
  leaves: LeaveRow[];
  weeksById: Map<string, WeekRow>;
  thresholds: Thresholds;
}

/**
 * Member-level analysis derived from per-week facts. This is the Answer_Key
 * grain: one verdict per member, with the weeks that were neutralised (valid
 * edge cases) recorded explicitly so an over-log backed by approved OT or a
 * full-leave week is never mistaken for a genuine issue.
 */
export interface MemberAnalysis {
  memberId: string;
  inScopeWeekCount: number;
  busyRate: number | null;
  effortConsumption: number | null;
  excludedWeeks: ExcludedWeek[];
}

function hasApprovedOt(memberId: string, week: WeekRow, leaves: LeaveRow[]): boolean {
  return leaves.some(
    (l) =>
      l.member_id === memberId &&
      l.approved === true &&
      isApprovedOtCompLeave(l.leave_type) &&
      dateInWeek(l.leave_date, week),
  );
}

function hasTraining(memberId: string, week: WeekRow, leaves: LeaveRow[]): boolean {
  return leaves.some(
    (l) =>
      l.member_id === memberId &&
      l.approved === true &&
      isTrainingLeave(l.leave_type) &&
      dateInWeek(l.leave_date, week),
  );
}

function groupByMember(facts: MemberWeekFact[]): Map<string, MemberWeekFact[]> {
  const map = new Map<string, MemberWeekFact[]>();
  for (const fact of facts) {
    const list = map.get(fact.memberId) ?? [];
    list.push(fact);
    map.set(fact.memberId, list);
  }
  return map;
}

/** Weeks where busy / N06 are structurally distorted and must not drive findings. */
function weekSuppressionReason(
  memberId: string,
  fact: MemberWeekFact,
  ctx: FindingsContext,
): SuppressionReason | null {
  const week = ctx.weeksById.get(fact.weekId);
  if (week && (week.holiday_hours_ft ?? 0) > 0) return 'holiday_week';
  if (week && hasApprovedOt(memberId, week, ctx.leaves)) return 'approved_ot';
  if (week && hasTraining(memberId, week, ctx.leaves)) return 'training';
  if (fact.availableHours === 0) return 'approved_leave';
  return null;
}

/**
 * Aggregate per-week facts into a member-level analysis.
 *
 * Busy rate and effort consumption share the same exclusion set: holiday weeks,
 * full-leave weeks (available = 0), approved-OT weeks, and training weeks.
 * Member busy = mean of remaining in-scope weeks; EC = Σlogged / Σplanned.
 */
export function analyzeMembers(facts: MemberWeekFact[], ctx: FindingsContext): MemberAnalysis[] {
  const byMember = groupByMember(facts);
  const analyses: MemberAnalysis[] = [];

  for (const [memberId, memberFacts] of byMember) {
    const inScope = memberFacts.filter((f) => f.scopeStatus === 'IN_SCOPE');
    const excludedWeeks: ExcludedWeek[] = [];

    let busySum = 0;
    let busyCount = 0;
    let loggedSum = 0;
    let plannedSum = 0;
    let anyActivity = false;

    for (const fact of inScope) {
      const reason = weekSuppressionReason(memberId, fact, ctx);
      if (reason) {
        excludedWeeks.push({ weekId: fact.weekId, reason });
        continue;
      }

      if (fact.busyRate !== null) {
        busySum += fact.busyRate;
        busyCount += 1;
      }
      loggedSum += fact.loggedHours;
      plannedSum += fact.plannedHours;
      if (fact.plannedHours > 0 || fact.loggedHours > 0) anyActivity = true;
    }

    // If a member has zero plan and zero log across the whole window, do not
    // classify them as "idle" at member-level. Surface this as 'no_plan' in
    // the member-week facts instead (data/planning gap).
    const busyRate = anyActivity && busyCount > 0 ? round4(busySum / busyCount) : null;
    const effortConsumption = anyActivity && plannedSum > 0 ? round4(loggedSum / plannedSum) : null;

    analyses.push({
      memberId,
      inScopeWeekCount: inScope.length,
      busyRate,
      effortConsumption,
      excludedWeeks,
    });
  }

  return analyses;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${Math.round(n * 100)}%`;
}

function busyRag(busy: number, t: Thresholds): RagColor {
  if (busy > t.overbookRedThreshold) return 'red';
  if (busy > t.overbookThreshold) return 'yellow';
  if (busy < t.idleThreshold) return 'red';
  return 'green';
}

/** Genuine overbook / idle findings (member-level). */
export function detectOverbookIdle(facts: MemberWeekFact[], ctx: FindingsContext): Finding[] {
  const findings: Finding[] = [];
  for (const a of analyzeMembers(facts, ctx)) {
    if (a.busyRate === null) continue;
    const { overbookThreshold, idleThreshold } = ctx.thresholds;

    if (a.busyRate > overbookThreshold) {
      findings.push({
        memberId: a.memberId,
        issueType: 'overbook',
        ragColor: busyRag(a.busyRate, ctx.thresholds),
        busyRate: a.busyRate,
        effortConsumption: a.effortConsumption,
        detail: `Busy ${pct(a.busyRate)} — overbooked, rebalance`,
        excludedWeeks: a.excludedWeeks,
      });
    } else if (a.busyRate < idleThreshold) {
      findings.push({
        memberId: a.memberId,
        issueType: 'idle',
        ragColor: busyRag(a.busyRate, ctx.thresholds),
        busyRate: a.busyRate,
        effortConsumption: a.effortConsumption,
        detail: `Busy ${pct(a.busyRate)} — under-allocated`,
        excludedWeeks: a.excludedWeeks,
      });
    }
  }
  return findings;
}

/** Genuine logged-vs-planned mismatch findings (member-level). */
export function detectMismatch(facts: MemberWeekFact[], ctx: FindingsContext): Finding[] {
  const findings: Finding[] = [];
  for (const a of analyzeMembers(facts, ctx)) {
    if (a.effortConsumption === null) continue;
    const drift = Math.abs(a.effortConsumption - 1);
    if (drift <= ctx.thresholds.mismatchPctThreshold) continue;

    const issueType = a.effortConsumption < 1 ? 'mismatch_under' : 'mismatch_over';
    findings.push({
      memberId: a.memberId,
      issueType,
      ragColor: 'red',
      busyRate: a.busyRate,
      effortConsumption: a.effortConsumption,
      detail:
        issueType === 'mismatch_under'
          ? `Effort consumption ${pct(a.effortConsumption)} — logged below plan`
          : `Effort consumption ${pct(a.effortConsumption)} — logged above plan`,
      excludedWeeks: a.excludedWeeks,
    });
  }
  return findings;
}
